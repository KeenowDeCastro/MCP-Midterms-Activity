# PLAN_LOG

> Append-only. Each session adds one entry at the bottom using append_file. Never rewrite old entries.
>
> Entry format:
>
> ## YYYY-MM-DD HH:MM · role · session N
> **Plan:** numbered steps, written BEFORE acting
> **Did:** what actually happened, including failed calls
> **Result:** done / partly done / blocked, and the handoff note for the next session
