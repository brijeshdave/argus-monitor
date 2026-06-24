// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// HTTP client for the agent push path: registration and telemetry ingest. The
// connection key travels in the x-argus-key header. Ingest distinguishes "not yet
// approved" (do not spool — just wait) from transport failures (spool + retry).
package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

// ErrNotApproved means the backend rejected ingest because the agent is pending.
var ErrNotApproved = errors.New("agent not approved")

type Client struct {
	base string
	key  string
	http *http.Client
}

func New(base, key string) *Client {
	return &Client{
		base: strings.TrimRight(base, "/"),
		key:  key,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Register(ctx context.Context, req model.RegisterRequest) (model.RegisterResponse, error) {
	var out model.RegisterResponse
	body, _ := json.Marshal(req)
	resp, err := c.post(ctx, "/api/agent/register", body)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return out, fmt.Errorf("register: status %d", resp.StatusCode)
	}
	return out, json.NewDecoder(resp.Body).Decode(&out)
}

// FetchConfig pulls this agent's enabled monitor list. Returns ErrNotApproved on
// HTTP 403 (agent still pending) so the caller can keep its last-known config.
func (c *Client) FetchConfig(ctx context.Context) (model.ConfigResponse, error) {
	var out model.ConfigResponse
	resp, err := c.get(ctx, "/api/agent/config")
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden {
		return out, ErrNotApproved
	}
	if resp.StatusCode/100 != 2 {
		return out, fmt.Errorf("config: status %d", resp.StatusCode)
	}
	return out, json.NewDecoder(resp.Body).Decode(&out)
}

// Ingest pushes one snapshot. Returns ErrNotApproved on HTTP 403.
func (c *Client) Ingest(ctx context.Context, body []byte) error {
	resp, err := c.post(ctx, "/api/agent/ingest", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode == http.StatusForbidden {
		return ErrNotApproved
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("ingest: status %d", resp.StatusCode)
	}
	return nil
}

// PushInventory uploads the host's discoverable services + processes. Best-effort:
// a non-2xx (e.g. 403 while pending) is returned for the caller to log and ignore.
func (c *Client) PushInventory(ctx context.Context, body []byte) error {
	resp, err := c.post(ctx, "/api/agent/inventory", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("inventory: status %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) post(ctx context.Context, path string, body []byte) (*http.Response, error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("content-type", "application/json")
	r.Header.Set("x-argus-key", c.key)
	return c.http.Do(r)
}

func (c *Client) get(ctx context.Context, path string) (*http.Response, error) {
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("x-argus-key", c.key)
	return c.http.Do(r)
}
