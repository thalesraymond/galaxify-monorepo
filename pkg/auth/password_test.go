package auth

import (
	"strings"
	"testing"
)

func TestHashPassword(t *testing.T) {
	tests := []struct {
		name      string
		plaintext string
		wantErr   bool
	}{
		{
			name:      "valid password",
			plaintext: "mysecretpassword123",
			wantErr:   false,
		},
		{
			name:      "empty password",
			plaintext: "",
			wantErr:   false,
		},
		{
			name:      "long password",
			plaintext: strings.Repeat("a", 1000),
			wantErr:   false,
		},
		{
			name:      "password with special characters",
			plaintext: "p@$$w0rd!#$%^&*()",
			wantErr:   false,
		},
		{
			name:      "password with unicode",
			plaintext: "пароль密码🔐",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash, err := HashPassword(tt.plaintext)
			if (err != nil) != tt.wantErr {
				t.Errorf("HashPassword() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && hash == "" {
				t.Error("HashPassword() returned empty hash")
			}
			if !tt.wantErr && !strings.HasPrefix(hash, "$argon2id$") {
				t.Errorf("HashPassword() hash does not start with $argon2id$, got: %s", hash)
			}
		})
	}
}

func TestHashPassword_UniqueHashes(t *testing.T) {
	plaintext := "samepassword"
	hash1, err := HashPassword(plaintext)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	hash2, err := HashPassword(plaintext)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash1 == hash2 {
		t.Error("HashPassword() produced identical hashes for same input (salt should differ)")
	}
}

func TestComparePasswordAndHash_Match(t *testing.T) {
	tests := []struct {
		name      string
		plaintext string
	}{
		{
			name:      "normal password",
			plaintext: "correctpassword",
		},
		{
			name:      "empty password",
			plaintext: "",
		},
		{
			name:      "special characters",
			plaintext: "p@$$w0rd!#$%",
		},
		{
			name:      "unicode",
			plaintext: "пароль密码🔐",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash, err := HashPassword(tt.plaintext)
			if err != nil {
				t.Fatalf("HashPassword() error = %v", err)
			}

			match, err := ComparePasswordAndHash(tt.plaintext, hash)
			if err != nil {
				t.Fatalf("ComparePasswordAndHash() error = %v", err)
			}
			if !match {
				t.Error("ComparePasswordAndHash() returned false for matching password")
			}
		})
	}
}

func TestComparePasswordAndHash_DifferentPasswords(t *testing.T) {
	hash, err := HashPassword("originalpassword")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}

	match, err := ComparePasswordAndHash("differentpassword", hash)
	if err != nil {
		t.Fatalf("ComparePasswordAndHash() error = %v", err)
	}
	if match {
		t.Error("ComparePasswordAndHash() returned true for different passwords")
	}
}

func TestComparePasswordAndHash_InvalidHash(t *testing.T) {
	_, err := ComparePasswordAndHash("password", "invalidhash")
	if err == nil {
		t.Error("ComparePasswordAndHash() expected error for invalid hash format")
	}
}
