# Task Tracker — Project Overview

A self-hosted, lightweight task management and reminder tool for a small team with a manager hierarchy. This document captures the *idea* — roles, rules, and workflow — separate from any code or schema, so it can be revisited and sanity-checked on its own.

---

## 1. Why this exists

Off-the-shelf self-hosted tools (Vikunja, Leantime, Nextcloud Deck, etc.) were evaluated first. All of them model permissions as **project/board sharing** — invite a person to a project, give them a role on that project. None of them model an **org-chart hierarchy**, where a manager automatically sees everything their direct reports are assigned, without inviting anyone to anything. That mismatch is the actual reason this is a custom build rather than an existing tool.

Constraints going in:
- Self-hosted, on a Proxmox LXC, low traffic (small team).
- Lightweight — should idle well under 100 MB RAM.
- Mobile-friendly notifications matter more than a native app feel.
- Friendly local URL instead of typing an IP:port.

---

## 2. Roles and hierarchy

Three roles: **Admin**, **Manager**, **User**.

- Every user optionally has one manager (a plain reports-to link — not a team object, not a project membership).
- A manager's "team" is simply *everyone whose manager is them*. No separate step is needed to add someone to a team.
- Admin sits above the hierarchy: full visibility and control everywhere, and can act as a manager or user when needed.

This single reports-to relationship is the entire foundation the visibility rules are built on — nothing else in the system needs to know about teams or departments.

---

## 3. What a task is

A task has a name, description, status, an optional due date, and can optionally belong under a parent task (a lightweight subtask mechanism — no separate "subtask" object, just a task pointing at another task).

Two things were deliberately separated out of the task itself:

- **Who's assigned** is not a single field. A task can have **multiple assignees**, and any one of them can mark it done — completion is shared, not owned by one person.
- **Who's allowed to act on the task** is not one blanket permission. It's split by *what kind of action* it is (see next section).

Deleting a task is a **soft delete** — hiding it rather than destroying it — because a hard delete would orphan its notes and its audit history, and the audit trail is a deliberate feature, not incidental.

---

## 4. The permission model

This is the core design decision of the whole project, and it's worth restating plainly:

**Visibility** — who can see a task at all:
- Admin: everyone's tasks.
- Manager: their own tasks, tasks assigned to them, and tasks assigned to anyone who reports to them.
- User: only tasks they created or are assigned to.

**Creating tasks** — everyone can create tasks:
- A user can only assign a new task to themselves.
- A manager can assign to themselves or to their own reports.
- Admin can assign to anyone.

**Acting on an existing task** is split into three separate permissions, not one:

| Action | Who |
|---|---|
| Edit name/description ("content") | The creator, or admin |
| Change status (including marking done) | The creator, any current assignee, or admin |
| Change due date, reassign, or delete ("logistics") | The creator, a manager of a current assignee, or admin |

The reasoning: a manager should be able to redirect priorities and timelines without rewriting what a team member wrote for themselves. Content stays with whoever authored it; logistics — the things that affect scheduling and delegation — sit with whoever is managing the outcome.

Notes inherit whatever visibility rule already applies to the task — no separate permission needed for adding a comment.

---

## 5. Notifications vs. the activity log

Two related but distinct concepts, kept separate on purpose:

- **Activity log** — the complete audit trail. Every action, by everyone, kept indefinitely. This answers "what happened to this task, and when." Nobody reads this casually; it exists for accountability and history.
- **Notifications** — a much smaller, personal, read/unread inbox. Only the things a specific person needs to be told about right now: they were assigned something, a note was added to their task, their task is due soon, or it's overdue.

Keeping them separate means notifications can be marked read, cleared, or pruned without ever losing the underlying history.

**What triggers a notification:**
- Assigned to a task → notify the new assignee.
- A note is added → notify the other assignees.
- Due within a day, and not yet done → notify assignees once.
- Past due, and not yet done → notify assignees once.

Each of these fires at most once per task, per person, per type — the system checks whether that notification already exists before writing a new one, so nobody gets repeatedly pinged by the same event.

---

## 6. The task lifecycle, in plain terms

1. Someone creates a task — for themselves, or (if manager/admin) for someone on their team.
2. Everyone who can see it sees it show up on their task list, no invitation step required.
3. Whoever is assigned works the task and updates its status as they go.
4. Anyone with visibility can leave a note; the other assignees get told about it.
5. If priorities shift, whoever holds "logistics" permission over that task can push the due date or hand it to someone else.
6. If a due date creeps up or passes, the system nudges the relevant people automatically — no one has to remember to check.
7. If a task stops being relevant, it's soft-deleted — it disappears from view, but its history isn't destroyed.

---

## 7. Notification delivery, technically speaking (not code-level)

Mobile notifications matter more than the app "feeling native," so the plan is:
- The web app is installable as a **PWA** (add to home screen), which is enough to get push notifications working on both Android and modern iOS.
- Actual push delivery goes through **ntfy**, a small self-hosted notification server — the app just tells ntfy "send this message," and ntfy's own app handles delivery to the phone. This avoids building or maintaining any push infrastructure directly.

---

## 8. Access and deployment shape

- Runs on a small Proxmox LXC container, no Docker required at this scale — a single lightweight process managed by systemd is simpler and lighter.
- SQLite as the database — a single file, no separate database service to run or back up separately.
- A reverse proxy (Caddy) sits in front so people type a friendly name (`tasks.yourdomain.com`) instead of an IP and port, and so the app gets real HTTPS — which the PWA install and push notifications both depend on.
- A real domain name (even a cheap one) was chosen over a bare LAN IP or a `.local` name, specifically because HTTPS certificates and PWA installability need a proper hostname to work reliably.

---

## 9. Open questions worth revisiting

- **Per-assignee completion**: right now, completing a shared task is a single shared status. If it ever matters to know *which* of several assignees actually did the work, that would need a small addition (a completion timestamp per assignee) rather than a redesign — the data model was left open for this.
- **Cancelled vs. deleted**: a task can be soft-deleted, but there's a separate question of whether "cancelled" (still visible, but explicitly not going to happen) should be a distinct state from "deleted" (hidden). Worth deciding once real usage shows which is more useful.
- **Subtask behavior**: subtasks currently just point at a parent task with no extra rules — they don't yet roll up progress to the parent, block the parent from completing, or inherit the parent's assignees. Fine for now, but worth a deliberate decision once subtasks are actually used.
