package expedition

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
)

// materialsDenominator is the fixed additive term in the success-chance
// formula: normalized investment is materials / (materials + denominator).
const materialsDenominator = 10

// Blocker identifies why a proposed launch is not eligible. BlockerNone means
// the launch is eligible. Blockers are part of the wire contract so the quote
// can report the same reason launch would reject with.
type Blocker string

const (
	// BlockerNone means the proposed launch passes every eligibility rule.
	BlockerNone Blocker = ""
	// BlockerInsufficientMaterials means the investment exceeds the balance.
	BlockerInsufficientMaterials Blocker = "EXPEDITION_INSUFFICIENT_MATERIALS"
	// BlockerAlreadyActive means an expedition is already IN_FLIGHT.
	BlockerAlreadyActive Blocker = "EXPEDITION_ALREADY_ACTIVE"
	// BlockerCooldown means the last expedition resolved too recently.
	BlockerCooldown Blocker = "EXPEDITION_COOLDOWN"
)

// Quote is the authoritative, informational projection of a proposed launch.
// It reuses the exact eligibility and success-chance rules launch applies, so
// launch can independently revalidate the same facts.
type Quote struct {
	MaterialsInvested      int32
	NormalizedInvestment   float64
	ProjectedBalance       int32
	SuccessChance          float64
	Eligible               bool
	Blocker                Blocker
	CooldownUntil          *time.Time
	EstimatedResolveAt     time.Time
	EstimatedResolveWindow time.Duration
}

// launchEvaluation is the shared decision computed from authoritative state.
// Both Launch and Quote derive their outcome from this single function so the
// quote can never drift from launch.
type launchEvaluation struct {
	normalizedInvestment float64
	successChance        float64
	blocker              Blocker
	cooldownUntil        *time.Time
}

// evaluateLaunch applies the launch eligibility rules in the same order launch
// enforces them: insufficient materials, then active expedition, then cooldown.
// It always computes the chance so an ineligible quote can still explain the
// investment it was asked about.
func evaluateLaunch(materialsInvested int32, ship database.UserShipStateCache, active bool, lastResolveAt *time.Time, now time.Time) launchEvaluation {
	normalizedInvestment := float64(materialsInvested) / (float64(materialsInvested) + materialsDenominator)
	evaluation := launchEvaluation{
		normalizedInvestment: normalizedInvestment,
		successChance:        normalizedInvestment * (float64(ship.HullHealth) / 100),
	}

	switch {
	case materialsInvested > ship.MaterialsBalance:
		evaluation.blocker = BlockerInsufficientMaterials
	case active:
		evaluation.blocker = BlockerAlreadyActive
	case lastResolveAt != nil && !lastResolveAt.Before(now.Add(-expeditionLength)):
		evaluation.blocker = BlockerCooldown
		cooldownUntil := lastResolveAt.Add(expeditionLength)
		evaluation.cooldownUntil = &cooldownUntil
	}
	return evaluation
}

func (m *manager) Quote(ctx context.Context, userID uuid.UUID, materialsInvested int32) (Quote, error) {
	if materialsInvested <= 0 {
		return Quote{}, ErrInvalidMaterials
	}

	pgUserID := pgUUID(userID)
	ship, err := m.store.GetShipCache(ctx, pgUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Quote{}, ErrShipStateNotReady
	}
	if err != nil {
		return Quote{}, fmt.Errorf("get ship cache: %w", err)
	}

	active := false
	if _, err := m.store.GetCurrentByUser(ctx, pgUserID); err == nil {
		active = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Quote{}, fmt.Errorf("get current expedition: %w", err)
	}

	var lastResolveAt *time.Time
	switch last, err := m.store.GetLastResolveAt(ctx, pgUserID); {
	case err == nil:
		resolvedAt := last.Time
		lastResolveAt = &resolvedAt
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return Quote{}, fmt.Errorf("get last expedition resolve time: %w", err)
	}

	now := m.now().UTC()
	evaluation := evaluateLaunch(materialsInvested, ship, active, lastResolveAt, now)
	return Quote{
		MaterialsInvested:      materialsInvested,
		NormalizedInvestment:   evaluation.normalizedInvestment,
		ProjectedBalance:       ship.MaterialsBalance - materialsInvested,
		SuccessChance:          evaluation.successChance,
		Eligible:               evaluation.blocker == BlockerNone,
		Blocker:                evaluation.blocker,
		CooldownUntil:          evaluation.cooldownUntil,
		EstimatedResolveAt:     now.Add(expeditionLength),
		EstimatedResolveWindow: 2 * jitterRange,
	}, nil
}
