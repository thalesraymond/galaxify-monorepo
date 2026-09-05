# ADR-0009: Dead Letter and Alternate Exchanges

- **Status:** Accepted
- **Date:** 2026-09-05
- **Source:** Engineering Discussion

## Context

In our RabbitMQ event-driven architecture (defined in ADR-0005), services publish and consume events from a single topic exchange (`galaxify.events`). We need to handle two edge cases:
1. **Processing Failures:** Messages that reach a service's queue but fail processing permanently (e.g., max retries exceeded, or rejected due to a bug) need to be saved for inspection and eventual replay.
2. **Unroutable Messages:** Messages that are published to `galaxify.events` but have no active queue bindings (e.g., due to a typo in the routing key, or publishing a new event type before any consumers are deployed) are silently dropped by RabbitMQ. We need a safety net to catch these.

The topology of how we capture these messages, where we store them, how we declare the infrastructure, and how we replay them must be standardized across the monorepo.

## Decision

We will implement a **global Dead Letter Exchange (DLX)** and a **global Alternate Exchange (AE)**, configured via **client-side Go arguments**, with replay handled by the **RabbitMQ Shovel plugin**.

### 1. Global Topology
- **Dead Letter Exchange:** A single fanout exchange `galaxify.dlx` bound to a single queue `galaxify.dead_letters`. When a message is rejected by a service (or TTLs/hits max retries), it is dead-lettered here. RabbitMQ automatically preserves the original queue name in the `x-death` header, making a single global queue easy to monitor without fragmenting dead letters across dozens of per-service queues.
- **Alternate Exchange:** A single fanout exchange `galaxify.ae` bound to a single queue `galaxify.unroutable`. If a message published to `galaxify.events` cannot be routed to any queue, it goes here instead of being dropped.

### 2. Configuration via Client-Side Arguments
We will define these exchanges and queues in `pkg/events`, and configure them using AMQP arguments in the Go codebase:
- When declaring the main `galaxify.events` exchange, we will pass the `alternate-exchange` argument pointing to `galaxify.ae`.
- When a service declares its queue, it will pass the `x-dead-letter-exchange` argument pointing to `galaxify.dlx`.

This keeps our Infrastructure-as-Code explicit and version-controlled right next to the code that uses it, avoiding the need for separate Terraform/RabbitMQ policy provisioning.

### 3. Replay Mechanism (Shovel Plugin)
When a bug is fixed or a missing service is deployed, messages in `galaxify.dead_letters` or `galaxify.unroutable` need to be replayed. Because AMQP preserves the original routing key in the message, re-routing them is as simple as publishing them back to `galaxify.events`.

For Phase 1, we will use the built-in **RabbitMQ Shovel plugin** via the RabbitMQ Management UI to move messages from these queues back to `galaxify.events`. This requires zero custom code. We can graduate to a custom Go CLI worker later if surgical filtering becomes necessary.

## Consequences

- `pkg/events/publisher.go` and `pkg/events/subscriber.go` will be updated to include the AE and DLX declarations and AMQP arguments.
- Our RabbitMQ instance must have the `rabbitmq_shovel` and `rabbitmq_shovel_management` plugins enabled for operators to perform replays via the UI.
- Developers must understand that scaling a service to 0 does *not* trigger the Alternate Exchange. Because our queues are `durable=true` and `autoDelete=false`, a down service simply leaves its queue intact to buffer messages, which is the correct and safe behavior for reliable event delivery.
