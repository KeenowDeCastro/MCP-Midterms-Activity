# Report outline (fill in yourself)

> These are prompts, not answers. Write each section in your own words from what you actually built, tested and observed. Delete this note before submitting.

## 1. Stack and why (rubric D)
For each layer, say what you chose and one reason you chose it over the alternative on slide 17.
- Runtime and SDK:
- Transport:
- Validation:
- Exposure (tunnel):
- Process manager:
- Version control:
- Testing:

## 2. Architecture (rubric D)
- How is the code split between server, tools and config? Why is the file logic kept separate from the MCP code?
- Why stateless HTTP? What happens to an agent's work if the server restarts?

## 3. Tool design choices (rubric C)
- Why these 13 tools, and why is each single-purpose?
- Pick two tool descriptions and explain how you wrote them so the model knows when to use them and how they fail (slide 9).
- How do errors reach the agent (isError), and give one example of an error message that tells the agent how to recover.
- Why does write_file require if_version to overwrite? Why does str_replace demand exactly one match?

## 4. Agents, roles and handoff (rubric A and B)
- What roles did you run, and which tools did each get? Why?
- Describe your multi-step demo task and how it was split across sessions.
- Show how PROJECT_STATE / PLAN_LOG / CHECKPOINTS / DECISIONS carried context from one session to the next.
- Efficiency: quote numbers from evidence/transcript.md (total calls, errors, repeats, average result size). What would you change to reduce calls?

## 5. Security and threats (rubric E)
List each threat, your defence, and how you tested it. Suggested threats to consider:
- Path traversal and absolute paths
- Symlinks leading out of the workspace
- Someone finding your public URL
- Token in the URL path showing up in logs (trade-off vs header)
- Two agents editing the same file
- An agent deleting or overwriting important work
- Planted git hooks
- What you did NOT defend against (rate limiting? token rotation? multiple server instances?)

## 6. What I learned / what I would do next
