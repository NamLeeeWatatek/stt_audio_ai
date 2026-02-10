package llm

import (
	"context"
	"strings"
)

// GroqService handles Groq API interactions (OpenAI-compatible)
type GroqService struct {
	*OpenAIService
}

// NewGroqService creates a new Groq service
func NewGroqService(apiKey string) *GroqService {
	baseURL := "https://api.groq.com/openai/v1"
	return &GroqService{
		OpenAIService: NewOpenAIService(apiKey, &baseURL),
	}
}

// GetContextWindow returns the context window size for a given Groq model
func (s *GroqService) GetContextWindow(ctx context.Context, model string) (int, error) {
	// Known context windows for Groq models
	switch {
	case strings.Contains(model, "llama-3.1-70b"):
		return 128000, nil
	case strings.Contains(model, "llama-3.1-8b"):
		return 128000, nil
	case strings.Contains(model, "llama3-70b"):
		return 8192, nil
	case strings.Contains(model, "llama3-8b"):
		return 8192, nil
	case strings.Contains(model, "mixtral-8x7b"):
		return 32768, nil
	case strings.Contains(model, "gemma-7b"):
		return 8192, nil
	default:
		// Default fallback
		return 8192, nil
	}
}
