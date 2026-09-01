package auth

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"testing"
)

func TestGeneratePrivatePublicKeyPair(t *testing.T) {
	t.Parallel()

	t.Run("success: returns valid PEM blocks", func(t *testing.T) {
		t.Parallel()

		privatePEM, publicPEM, err := GeneratePrivatePublicKeyPair()
		if err != nil {
			t.Fatalf("GeneratePrivatePublicKeyPair() error = %v", err)
		}

		if privatePEM == nil {
			t.Fatal("privatePEM is nil")
		}
		if publicPEM == nil {
			t.Fatal("publicPEM is nil")
		}

		// Verify private key PEM
		privBlock, _ := pem.Decode(privatePEM)
		if privBlock == nil {
			t.Fatal("failed to decode private key PEM")
		}
		if privBlock.Type != "PRIVATE KEY" {
			t.Errorf("private key PEM type = %q, want %q", privBlock.Type, "PRIVATE KEY")
		}

		// Verify public key PEM
		pubBlock, _ := pem.Decode(publicPEM)
		if pubBlock == nil {
			t.Fatal("failed to decode public key PEM")
		}
		if pubBlock.Type != "PUBLIC KEY" {
			t.Errorf("public key PEM type = %q, want %q", pubBlock.Type, "PUBLIC KEY")
		}
	})

	t.Run("success: keys are Ed25519", func(t *testing.T) {
		t.Parallel()

		privatePEM, _, err := GeneratePrivatePublicKeyPair()
		if err != nil {
			t.Fatalf("GeneratePrivatePublicKeyPair() error = %v", err)
		}

		block, _ := pem.Decode(privatePEM)
		if block == nil {
			t.Fatal("failed to decode private key PEM")
		}

		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			t.Fatalf("ParsePKCS8PrivateKey() error = %v", err)
		}

		// Type assertion to verify it's Ed25519
		if _, ok := key.(ed25519.PrivateKey); !ok {
			t.Errorf("key type = %T, want ed25519.PrivateKey", key)
		}
	})

	t.Run("success: different calls produce different keypairs", func(t *testing.T) {
		t.Parallel()

		privatePEM1, publicPEM1, err := GeneratePrivatePublicKeyPair()
		if err != nil {
			t.Fatalf("first call error = %v", err)
		}

		privatePEM2, publicPEM2, err := GeneratePrivatePublicKeyPair()
		if err != nil {
			t.Fatalf("second call error = %v", err)
		}

		if string(privatePEM1) == string(privatePEM2) {
			t.Error("two calls produced identical private keys")
		}
		if string(publicPEM1) == string(publicPEM2) {
			t.Error("two calls produced identical public keys")
		}
	})
}

func TestLoadPrivatePublicKeyPair(t *testing.T) {
	t.Parallel()

	t.Run("success: round-trip", func(t *testing.T) {
		t.Parallel()

		// Generate a keypair
		privatePEM, publicPEM, err := GeneratePrivatePublicKeyPair()
		if err != nil {
			t.Fatalf("GeneratePrivatePublicKeyPair() error = %v", err)
		}

		// Load the private key
		priv, pub, err := LoadPrivatePublicKeyPair(privatePEM)
		if err != nil {
			t.Fatalf("LoadPrivatePublicKeyPair() error = %v", err)
		}

		if priv == nil {
			t.Fatal("priv is nil")
		}
		if pub == nil {
			t.Fatal("pub is nil")
		}

		// Verify the loaded public key matches the generated one
		pubBlock, _ := pem.Decode(publicPEM)
		if pubBlock == nil {
			t.Fatal("failed to decode public key PEM")
		}

		generatedPub, err := x509.ParsePKIXPublicKey(pubBlock.Bytes)
		if err != nil {
			t.Fatalf("ParsePKIXPublicKey() error = %v", err)
		}

		// Compare the public keys
		loadedPubBytes := pub
		generatedPubBytes := generatedPub.(ed25519.PublicKey)

		if len(loadedPubBytes) != len(generatedPubBytes) {
			t.Errorf("public key length mismatch: got %d, want %d", len(loadedPubBytes), len(generatedPubBytes))
		}

		for i := range loadedPubBytes {
			if loadedPubBytes[i] != generatedPubBytes[i] {
				t.Errorf("public key mismatch at byte %d", i)
				break
			}
		}
	})

	t.Run("error: nil input", func(t *testing.T) {
		t.Parallel()

		_, _, err := LoadPrivatePublicKeyPair(nil)
		if err == nil {
			t.Error("expected error for nil input, got nil")
		}
	})

	t.Run("error: empty input", func(t *testing.T) {
		t.Parallel()

		_, _, err := LoadPrivatePublicKeyPair([]byte{})
		if err == nil {
			t.Error("expected error for empty input, got nil")
		}
	})

	t.Run("error: invalid PEM", func(t *testing.T) {
		t.Parallel()

		_, _, err := LoadPrivatePublicKeyPair([]byte("not a PEM block"))
		if err == nil {
			t.Error("expected error for invalid PEM, got nil")
		}
	})

	t.Run("error: wrong PEM type", func(t *testing.T) {
		t.Parallel()

		// Create a PEM block with wrong type
		wrongPEM := pem.EncodeToMemory(&pem.Block{
			Type:  "CERTIFICATE",
			Bytes: []byte("fake data"),
		})

		_, _, err := LoadPrivatePublicKeyPair(wrongPEM)
		if err == nil {
			t.Error("expected error for wrong PEM type, got nil")
		}
	})

	t.Run("error: invalid DER content", func(t *testing.T) {
		t.Parallel()

		// Create a valid PEM structure but with invalid DER
		invalidDER := pem.EncodeToMemory(&pem.Block{
			Type:  "PRIVATE KEY",
			Bytes: []byte("not valid DER"),
		})

		_, _, err := LoadPrivatePublicKeyPair(invalidDER)
		if err == nil {
			t.Error("expected error for invalid DER content, got nil")
		}
	})

	t.Run("error: not Ed25519 key", func(t *testing.T) {
		t.Parallel()

		// Generate an ECDSA key (not Ed25519)
		ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatalf("failed to generate ECDSA key: %v", err)
		}

		// Marshal as PKCS8
		der, err := x509.MarshalPKCS8PrivateKey(ecdsaKey)
		if err != nil {
			t.Fatalf("failed to marshal ECDSA key: %v", err)
		}

		// Encode as PEM
		ecdsaPEM := pem.EncodeToMemory(&pem.Block{
			Type:  "PRIVATE KEY",
			Bytes: der,
		})

		_, _, err = LoadPrivatePublicKeyPair(ecdsaPEM)
		if err == nil {
			t.Error("expected error for non-Ed25519 key, got nil")
		}
	})
}
