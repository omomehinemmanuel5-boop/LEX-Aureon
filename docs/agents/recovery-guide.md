# Recovery guide for agents

This guide is for any agent that calls Lex. It tells you what each recovery
state means, what to do in each one, and when to stop and report to the owner.
Read it before you retry a denied request.

## The states you will see

- **QUARANTINED**: the session's trajectory is below the floor (M < 0.05). All
  governed execution is suspended, including reads that depend on the gate.
  Use the reset endpoint if `quarantined: true` appears in the response.
- **RESTORING**: the session has a healthy trajectory (M at or above 0.15) but
  does not yet have a canary. Consequential actions are denied. Reads work.
- **VERIFIED / NORMAL**: a canary has passed. Consequential actions still need
  per-action approval.
- **UNINITIALIZED**: no trajectory exists yet. A consequential call creates one
  at the uniform starting state, which is RESTORING.

## Recovering from RESTORING

1. Check the state with `get_constitutional_state` (read-only; it does not
   count as an observation).
2. Request a recovery pulse with `request_recovery_pulse`. It takes no
   arguments. The server binds the session.
3. Wait at least 5 seconds before the next pulse. After one breach, wait 10
   seconds. After two or more breaches, wait 15 seconds.
4. Repeat until `n_stable` reaches 3 of 3 and velocity is below 0.02.
5. The server then issues the recovery canary automatically on the next governed
   read. Check `get_constitutional_state` for `canary_passed: true`.
6. Retry the consequential action. It will still need the owner's per-action
   approval.

A pulse never grants write authority. It only records a time-separated
observation, or a bounded correction below the recovery threshold.

## Recovering from QUARANTINED

1. Confirm the denial says `quarantined: true` and includes `reset`.
2. Call the reset endpoint with the owner's API key, using the header named in
   `reset.header`. Reset only your own session. It is refused if the session is
   not below the floor.
3. Retry the original request. A fresh uniform trajectory is created on the next
   governed call. That state is RESTORING, so follow the steps above.
4. If the reset response says `paused`, stop and report to the owner. Do not
   retry in a loop.

## What not to do

- Do not retry a denied consequential request in a loop. Retries do not count as
  observations, and they add noise to the audit log.
- Do not wait less than the required spacing between pulses. A pulse that is too
  early is not counted.
- Do not treat a healthy diagnostic reading as proof of recovery. Check
  `recovery_state` and `canary_passed`.
- Do not use the operator canary or the operator recovery tools. They are
  operator-only.
- Do not ask the owner for a key in chat, and do not put a key into a request
  body or a log.

## When to stop and report

Stop and report to the owner when:
- A reset returns `paused`, or `archive_failed`.
- The state stays RESTORING after 3 pulses that met the spacing rule.
- A consequential action is denied for a reason other than recovery, such as an
  unknown tool, a blocked argument, or a missing approval.
- Any response contains a value you were not expecting, such as a key or a
  password.

## Summary

Reads always work. A pulse moves you toward recovery, with spacing. A reset
clears quarantine once. Consequential writes always need a human approval.
