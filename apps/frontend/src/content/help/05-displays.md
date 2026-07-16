---
title: Wallboards, ticker & status
order: 50
---

## Wallboards & display devices

**Wallboards** are full-screen NOC boards for control-room TVs. Build them with
drag-and-drop tiles (status grids, metric charts, clocks and more), then display
them in a chrome-less kiosk that auto-refreshes.

**Pairing an unattended screen**

1. Open the **/display** (or **/wall**) URL on the TV's browser. It shows a 6-digit
   pairing code.
2. In **Display devices**, approve the device and assign it a wallboard and a device
   group.
3. The screen stores a device token and from then on renders its assigned board
   automatically, even across reboots, with no operator login.

Boards can rotate through multiple layouts, and **device groups** let you target
content (and ticker messages) to specific walls.

> **A paired display can only show its wallboard.** It is an unattended screen, not
> an operator account: it cannot reach the dashboard, agents, admin or any other
> page, and the server rejects those requests even if the URL is typed in directly.
> To administer Argus from that browser, sign in normally as a user.

If a screen lands on the sign-in page, use **"Open wallboard display"** on that page
to go to the board / pairing code — no operator login required.

## The ticker (announcements)

The ticker is the scrolling bar of important notices. Create messages with a
**severity** (info / warning / critical), an optional **live window** (start/end
time), and **audience targeting**.

- **Severity** colours the bar; critical messages are larger and blink to draw
  attention.
- **Audience** — show a message on specific wall device-groups and/or to specific
  user-groups (leave blank for everyone).
- **Live window** — schedule a message to appear and disappear automatically.
- **Scroll speed** is adjustable for all screens from the ticker admin page.

## Public status page

The **/status** page is a fully public, unauthenticated status page you can share
with customers. It is secure-by-construction — it only ever exposes coarse,
hand-picked status items (label / status / uptime / history), never internal
details.

Choose exactly which components appear, and in what order, in **Admin → Public
status**. You can also publish an operator notice (info / maintenance / incident).
