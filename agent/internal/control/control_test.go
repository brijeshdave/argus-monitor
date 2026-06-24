// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
package control

import "testing"

func TestWsURL(t *testing.T) {
	cases := map[string]string{
		"https://argus.example.com":      "wss://argus.example.com/ws/agent",
		"http://localhost:8080":          "ws://localhost:8080/ws/agent",
		"https://argus.example.com/":     "wss://argus.example.com/ws/agent",
		"http://10.0.0.5:8080/argus":     "ws://10.0.0.5:8080/ws/agent",
	}
	for in, want := range cases {
		if got := wsURL(in); got != want {
			t.Errorf("wsURL(%q) = %q, want %q", in, got, want)
		}
	}
}
