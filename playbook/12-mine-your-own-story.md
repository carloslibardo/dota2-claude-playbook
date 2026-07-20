# 12. Mine Your Own Story

Everything in this playbook was recovered after the fact from transcripts, git history and
artifacts on disk. None of it was written down while it happened, because while it was
happening we were busy.

That is the normal situation, and it is fine — the record exists whether or not you curate it
as you go. This chapter is how to get at it: where Claude Code keeps your transcripts, what
those files contain, how to count things in them accurately, and how to turn the result into a
story that is both interesting and true.

There is a specific reason to care about the "and true" part, and it opens the chapter.

---

## 12.1 Where your transcripts live, and the trap in the path

Claude Code writes one JSONL file per session under:

```
~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl
```

The slug is the working directory with slashes replaced by dashes. A session started in
`/Users/you/projects/archer-wars` lands in:

```
~/.claude/projects/-Users-you-projects-archer-wars/
```

Here is the trap, and it is the single most important methodological point in this chapter:

> **Sessions are keyed by the directory you launched `claude` from, not by the repository you
> worked on.**

For long stretches of the Archer Wars build, `claude` was launched from a general-purpose
`~/carlos/projects/playground` directory while the work targeted the Archer Wars repo. The
consequence: **74 sessions in the playground directory reference `archer_wars`**, and two of
them are the *primary* build sessions — one 73 MB file spanning July 4 to July 11, and one
117 MB file spanning July 8 to July 13.

If you reconstruct this project's history from `-Users-you-projects-archer-wars/`
alone, you find a hole from July 9 to July 12. That hole contains the quality-gate era, the
showcase work, the three rejected evidence deliverables and the "camera never moved" incident —
which is to say, it contains most of this playbook.

Also worth knowing: git worktrees get their own slug. The twelve parallel bot-engine implementer
agents wrote 13 JSONL files into
`…-archer-wars--claude-worktrees-bot-engine/`, a directory you will not find unless you go
looking for it.

**Before you count anything, find every directory that mentions your project:**

```bash
cd ~/.claude/projects
grep -rl "archer_wars" . --include="*.jsonl" | cut -d/ -f2 | sort | uniq -c | sort -rn
```

Replace `archer_wars` with a string unique to your project — an addon name, a repo name, a
distinctive function name. Then decide deliberately which of those directories are in scope,
and say which ones in your writeup. This is the difference between "we counted the transcripts"
and "we counted some of the transcripts."

Scale, for calibration: at the time of the sweep the Archer Wars corpus was roughly 103 MB
across 23 JSONL files in the archer-wars directories, plus about 190 MB in the two primary
playground sessions — 36 sessions in one place and 74 in the other. (The classifier below
reports 33 rather than 36 for the same directories: it only counts sessions that contain at
least one user-role record. Every number in this chapter is a measurement of a live, growing
directory, which is exactly why each one needs a date on it.) These files are big and they are
all plain text.

## 12.2 JSONL anatomy

Each line is one JSON object. The fields you will actually use:

| Field | Meaning |
|---|---|
| `type` | `"user"` or `"assistant"` (also system-ish records) |
| `sessionId` | groups lines into a session |
| `timestamp` | ISO 8601 — how you build a timeline |
| `isMeta` | harness-generated record, not something a human wrote |
| `message.content` | either a plain string, or a list of content blocks |

The critical subtlety, and the source of every wrong count you will produce on your first try:

> **A `"type":"user"` record is not the same thing as a human typing something.**

Records with `type: "user"` include:

- actual typed prompts (what you want);
- **tool results** — every file read, every bash output, every grep result comes back as a user
  record containing a `tool_result` block. These vastly outnumber real prompts;
- **slash-command wrappers**, which appear as text containing `<command-name>` or
  `<local-command…>`;
- **interrupt markers** (`[Request interrupted…]`);
- **meta records** (`isMeta: true`) — compaction summaries, injected context, and similar;
- in team setups, `<teammate-message>` injections and task notifications.

On the assistant side, `message.content` is a list of blocks, and the ones with
`type: "tool_use"` are the agent's actions. Counting those gives you the agent's activity level.

Because tool results and tool calls are two sides of one event, `tool_result` user records and
`tool_use` assistant blocks should come out equal. That equality is a useful correctness check
on your own script — and, as the next section shows, it is also how a wrong number got caught.

## 12.3 The classifier

This is the script that produced the numbers in the published launch post. It is reproduced
verbatim from the session that ran it, because it is tested and because small changes to the
filters change the answer.

**Step 1 — the naive count, and the filtered count.** Worth running both, so you see the gap:

```bash
cd ~/.claude/projects && \
for d in -Users-you-projects-archer-wars \
         -Users-you-projects-archer-wars--claude-worktrees-bot-engine; do
  echo "== $d"; cat $d/*.jsonl 2>/dev/null | grep -c '"type":"user"'
done
# then filter tool_result + isMeta:
cat -- -Users-you-projects-archer-wars/*.jsonl \
       -Users-you-projects-archer-wars--claude-worktrees-bot-engine/*.jsonl \
| python3 -c "
import sys, json
n=0
for line in sys.stdin:
    try: j=json.loads(line)
    except: continue
    if j.get('type')!='user': continue
    c=j.get('message',{}).get('content')
    if isinstance(c,list) and any(isinstance(b,dict) and b.get('type')=='tool_result' for b in c): continue
    if j.get('isMeta'): continue
    n+=1
print(n)"
```

That returned **366**, which is still too high — slash-command wrappers are being counted as
prompts.

**Step 2 — the accurate classifier.** This is the reusable one. It doesn't just count; it
reports every bucket, so you can see what you excluded and defend it later:

```bash
cat ~/.claude/projects/-Users-you-projects-archer-wars*/*.jsonl | python3 -c "
import sys, json
real=0; cmd=0; interrupt=0; toolres=0; meta=0
sessions=set()
for line in sys.stdin:
    try: j=json.loads(line)
    except: continue
    if j.get('type')!='user': continue
    sessions.add(j.get('sessionId'))
    if j.get('isMeta'): meta+=1; continue
    c=j.get('message',{}).get('content')
    if isinstance(c,list) and any(isinstance(b,dict) and b.get('type')=='tool_result' for b in c): toolres+=1; continue
    txt = c if isinstance(c,str) else ' '.join(b.get('text','') for b in c if isinstance(b,dict))
    if '<command-name>' in txt or '<local-command' in txt: cmd+=1; continue
    if '[Request interrupted' in txt: interrupt+=1; continue
    real+=1
print(f'real={real} cmd={cmd} interrupt={interrupt} toolres={toolres} meta={meta} sessions={len(sessions)}')"
```

Output:

```
real=306 cmd=60 interrupt=0 toolres=2576 meta=70 sessions=33
```

**Step 3 — the agent's side:**

```bash
cat ~/.claude/projects/-Users-you-projects-archer-wars*/*.jsonl | python3 -c "
import sys, json
a=0; tools=0
for line in sys.stdin:
    try: j=json.loads(line)
    except: continue
    if j.get('type')=='assistant':
        a+=1
        c=j.get('message',{}).get('content')
        if isinstance(c,list): tools+=sum(1 for b in c if isinstance(b,dict) and b.get('type')=='tool_use')
print(f'assistant_msgs={a} tool_calls={tools}')"
```

Output:

```
assistant_msgs=5528 tool_calls=2576
```

Note `tool_calls == toolres == 2576`. The two independent counts agree, which is your evidence
that the classifier is bucketing correctly.

A related sweep worth running is the tool-type histogram, because it characterizes your project
in one line. A later pass over the archer-wars directories broke the calls down as
**Bash 1,536, Read 335, Edit 256, Agent 75, Write 65, SendMessage 33, AskUserQuestion 26**, out
of **2,721** total.

That total is not the 2,576 above, and the honest answer is that we cannot fully attribute the
gap: the two sweeps were run four days apart — July 15 and July 19 — over a corpus that was
still being written, by different scripts (the Python classifier above versus a `jq` pass). The
directory held 23 transcript files at the first count and thirty by the second, so at least
some of the difference is simply more sessions. Take the lesson rather than the number: **stamp
every count with the date and the script that produced it**, or you will find yourself unable
to reconcile your own figures a week later. The 2,576 is the one that shipped, because it
cross-checks against the `tool_result` count; the histogram is here for its shape, not its sum.

Bash dominance at that ratio
is the signature of an infrastructure-heavy project: VM control, ssh, ffmpeg, git. A web app
would show Edit and Read on top. Your histogram tells a reader what kind of work this really
was, without you having to characterize it.

## 12.4 The 2,585 that wasn't

Here is the story that makes this chapter matter.

When the launch post was drafted, its closing line was:

> "2,585 prompts. 20 kills to win. Built with Claude Code."

It is a great number. It is the kind of number that gets a post shared. An earlier in-session
agent had counted roughly 2,585 user turns across 20 transcripts totalling 98 MB, and that
figure went straight into the draft.

Before publishing, the human asked the obvious question:

> `fix this ending - do we did 2585 prompt? how it's calculaded? do we have a better ending?`

So the agent counted properly — the three escalating scripts above — and found something
better than a correction. The report back:

> "The number was wrong. I counted the actual archer-wars session history: it matches the
> agent's **2,576 tool calls** (builds, tests, VM matches), not your prompts. You wrote **306
> prompts** across 33 sessions. That asymmetry is a much better ending."

The number the human had been about to publish as *their own prompt count* was, to within nine,
**the agent's tool-call count**. The naive count of `"type":"user"` records had swept up all
2,576 tool results, and a human's 2,585 prompts and an agent's 2,576 tool calls are numbers
that look almost identical and mean opposite things.

The ending that shipped instead:

> "Final tally: 306 prompts from me. 2,576 commands executed by the agent. One game back from
> the dead. 20 kills to win — see you in the arena."

**The lesson is not "check your numbers," although yes.** The lesson is this:

> **Prefer the true number to the impressive number — the true one is usually a better story.**

"2,585 prompts" is a volume brag. It says the human typed a lot. "306 prompts from me, 2,576
commands executed by the agent" is smaller, true, and carries the actual thesis: a leverage
ratio of roughly one to eight. One human sentence, eight agent actions. That ratio *is* the
argument for agentic development, and it was sitting inside the mistake the whole time.

Reframing a stat as a **ratio between two agents** beat quoting a single volume number. Look for
that move in your own data.

## 12.5 Reconciling numbers that disagree

If you mine hard enough, you will produce two defensible numbers for the same thing. Here is
where that happened to us, stated openly, because a playbook about "prove it, don't claim it"
does not get to pick a convenient single truth.

### Prompts: 306 versus ~249

**306** is what the classifier reported in the launch-post session (July 15). It swept the
`~/.claude/projects/-Users-you-projects-archer-wars*` directories — the main project
directory plus the bot-engine worktree directory — across 33 sessions, excluding tool results,
meta records and slash-command wrappers.

**≈249** is what a later, deeper sweep found: 118 typed prompts from the archer-wars
directories, plus 92 from one primary playground session and 39 from the other, after
additionally filtering `<teammate-message>` injections, task notifications, compaction
summaries and the consecutive duplicate sends (several prompts appear two to six times with
near-identical timestamps; one rejection message was sent six times).

So the two numbers differ in **two directions at once**: the deeper sweep covers *more*
directories (it includes the playground sessions that the wildcard missed entirely) and applies
*stricter* filters (it removes injected messages and duplicates that the classifier counted as
real).

We are not going to pick one. The honest statement is: **the human typed on the order of 250 to
300 real prompts, depending on whether you count duplicate sends and harness-injected messages,
and depending on which working directories you sweep.** Both counts are defensible; they measure
slightly different things.

The related figure, **3,182 raw user-role records** in the archer-wars directories alone, is
what an unfiltered count gives you — and is the number that produced the 2,585 error. When
publishing, the safest phrasing is "~2,600 turns / ~250–300 typed prompts," with the method
stated.

### Commits: 318 versus 352 versus 274

**318** is the number in the published post. It came from the human's own draft and was never
re-derived in that session.

Counting afterwards: **352 commits across all local refs** (366 counting remote-only branches;
an earlier sweep read 365 before a docs commit landed), **274 on `main`**. The gap is real work on
unmerged branches — notably a spec branch sitting 45 commits ahead of `main` — plus the fact
that four squash-merged pull requests on `main` each carry roughly twenty underlying branch
commits. So `main`'s commit count *understates* the work by a lot, and the all-refs count
includes branches that were never merged.

State which you mean. `git rev-list --count HEAD` and `git rev-list --count --all` answer
different questions, and for a project with squash merges and live branches the difference is
not cosmetic.

**The general practice:** every number you publish should carry a one-line derivation somewhere
you can point to. We keep a provenance table — stat, value, exact derivation, confidence level
(`verified` / `corroborated` / `user-asserted` / `unverified`). It takes ten minutes and it is
what lets you answer "where did that come from" a month later without re-deriving anything.

## 12.6 Ten storytelling lessons

From building and revising the launch post, condensed.

**1. The failures are the product.** The hinge line of the whole post was "Honestly, the failures
were the best part." Every bug vignette does double duty — it entertains, and it proves the
guardrails were *earned* rather than theorized. This is what makes a "here's my playbook" ending
land as generosity instead of a funnel.

**2. Open on a loss, not a build.** The strongest opening was not "I built a game." It was "Then
Steam moderation removed it and it was just... gone. No source code, no backup, nothing." Stakes
first, then the detective work — Wayback snapshots, a fan wiki, a forgotten 2015 GitHub mirror,
a parsed binary Warcraft 3 map file — then one concrete payoff: *one ability's design survived
16 years across three games, and we kept it.* A single artifact can carry a sixteen-year arc.

**3. Find the claim that reframes the artifact.** "Nobody is playing." The video looks like
gameplay footage; the interesting fact is that it is a fully autonomous ten-bot match recorded
by the VM that runs it. That one sentence turns "look at my game" into "look at the machine that
tests my game," and it pre-empts the skeptical reading of the footage. The agent's own note
called it "the most shareable claim in the whole piece," and it was right.

**4. The self-indicting beat buys all the other credibility.** "The AI told me a gameplay video
was 'verified' when the camera never moved for the entire match. It read the logs, not the
pixels." Admitting the agent was wrong *and that you believed it* is what licenses every other
claim in the piece. The rule that follows — watch the frames — is memorable precisely because it
visibly cost something.

**5. Show, then invite.** A build log without an invitation is a brag. The turn was explicit: "I
don't just want to show you this — I want you to build one too."

**6. Prefer the true number.** §12.4.

**7. Reframe elapsed time as the right bottleneck.** "11 days" became "~6 hours hands-on — the
slow part was the loop between the agent and the VM: push, wait for a full match, watch the
recording, feed it back." That converts a vanity duration into a technical insight. Note that
it is also the most challengeable claim in the piece, so it ships with its justification
attached rather than as a bare number.

**8. Ground every detail in retrievable evidence, and refuse to invent the rest.** Twice during
drafting the agent stopped to check build memory before writing — "better real than invented" —
and once deliberately wrote *around* a gap, keeping the progression-database paragraph
backend-agnostic because the record didn't say whether storage was Steam Cloud or an external
database. The specificity readers reward — "39 orders per second," "ten minutes of combat, zero
kills," "a floating health bar and a raw localization string" — only exists because none of it
was made up.

**9. Rhythm caps the beat count.** Bug vignettes were capped at three in the thread; the
spawn-sealed-in-trees story got cut for pacing despite being funny. The call-to-action got its
own beats rather than being crammed in — "cramming into 6 killed rhythm." And format constraints
force late line-level edits (a tweet came in at 284 weighted characters against a 280 limit and
had to be trimmed word by word). Budget time for that.

**10. Every strong beat is a two-column pair: failure → rule.** Invisible owl → effect-level
test gates. Grapple that never pulled → verify effects, not cooldowns. "Verified" video with a
frozen camera → extract frames and look. That pairing is the native format of this kind of
writing — it is the structure of [chapter 11](11-failure-casebook.md), and it was already latent
in the post before anyone named it.

**A caveat on embellishment, since it applies to us.** The post claims the trailer agent "synced
the beat drop to the quad-kill spree." When we went looking for evidence of that, a grep across
every archer-wars transcript for `chorus|beat drop|quad-kill|quad kill` returned **zero
matches**. The claim arrives fully formed in the human's first draft and is never discussed
again. It may well have happened in a session outside the directories we swept — see §12.1, this
is exactly the failure mode — or it may be a small embellishment. What *is* documented is the
verifiable part: frames were extracted from the finished trailer and read before publishing. If
your piece's thesis is "prove it, don't claim it," audit your own copy against your own standard
before you publish. We are printing ours because finding one is normal, and pretending otherwise
would be the actual failure.

## 12.7 Annotate your git history, don't rewrite it

The temptation at the end of a project like this is to clean up the commit log. Squash the
messy days, rewrite the terse merges, produce a history that reads like the story you're about
to tell.

Don't. We considered it seriously, priced it out, and concluded the cost is real and the gain is
close to zero.

**What a `main` rewrite would have cost:**

- **Nine GitHub pull requests detach.** Every merged PR points at a SHA. Force-push turns each
  merged commit into a dangling object; the PR pages survive but their diffs, review comments
  and file links go stale. That is the richest external record of the project, and rewriting
  cannot recover it.
- **Squash provenance is the only link to ~80 branch commits.** Four commits on `main` are
  squashes of four spec branches. Rewriting severs the relationship GitHub currently renders.
- **A live 45-commit branch would need rebasing** — and it holds the newest work.
- **A concurrent Claude session had five worktrees registered against those refs.** A force-push
  underneath it produces exactly the detached-HEAD confusion that a project memory entry was
  written to prevent.
- **The remote VM's clone can no longer fast-forward.** Somebody has to go re-clone a cloud
  instance to fix a cosmetic git problem.
- **Authenticity.** Timestamps like *25 commits in the 04:00 hour* and *three subsystems found
  dead at 21:30* are the best evidence the story has. Rewritten history — even with dates
  preserved — turns every one of those from a receipt into a claim.

**What it would have gained:** almost nothing. Squashing the fix bursts into tidy features would
*destroy the most interesting signal in the repo.* The commit-type mix is 104 `feat` against 86
`fix` — a fix-to-feature ratio of 0.83, which is arguably the single most story-relevant number
in the whole project. The 86 fixes **are** the story. Tidying them away to look competent
deletes the evidence that the competence was earned.

The only genuine blemishes were five terse merge commits clustered in a three-minute window, two
duplicated subjects from a bad merge, and one generated 571,000-line map seed file inflating the
line-count stats. Those are a footnote and a `--` pathspec, not a reason for surgery.

**Do this instead:**

1. **Add annotated tags at the phase boundaries.** `v0.1-first-match`, `v0.2-heroes-spawn`,
   `v0.3-bots-alive`, `v0.4-map-flat`, `v0.5-frame-verified`. Tags are purely additive, break
   nothing, and give your article stable clickable anchors.
2. **Write `docs/HISTORY.md`** — the phase table plus your story-beat commits, each linking to
   `github.com/<you>/<repo>/commit/<sha>`. Zero risk, total narrative control, and it lives next
   to the code instead of on a blog.
3. **Optionally merge the live branch into `main` first**, so the default branch actually
   reflects the finished project before you point readers at it.
4. **Optionally clean the periphery** — prune stale worktrees, delete merged branches — after
   coordinating with any concurrent session.

The commit messages are doing the work already, if you wrote them well. These are real subjects
from the log, and they need no editing to belong in an article:

```
fix(systems): rewrite shopZone.ts to poll — trigger-touch events don't exist
fix(heroes): pure-ASCII npc_heroes_custom.txt so engine encoding sniff stops rejecting the whole hero file
fix(bots): hold engage orders during cast windup — bots issued 39 cast orders/s, zero arrows released
fix(i18n): ability tooltips dead — addon localization must be UTF-16 LE, not UTF-8
fix(build): disable TSTL sourceMapTraceback — retail macOS strips Lua debug lib
```

Each one names the failure it fixes. That is a habit to adopt on day one, and it is the cheapest
possible investment in a story you don't yet know you'll want to tell.

---

## Checklist

- [ ] Found **every** `~/.claude/projects/` directory that mentions your project, including
      worktree directories, and said which ones you swept.
- [ ] Counted with the classifier, not `grep -c '"type":"user"'`.
- [ ] Checked that `tool_calls == tool_result count` as a correctness test.
- [ ] Built a provenance table: stat → derivation → confidence.
- [ ] Reconciled any two numbers that disagree, in public, instead of picking the nicer one.
- [ ] Audited your own copy for claims you can't source.
- [ ] Tagged the phase boundaries and wrote `HISTORY.md` instead of rewriting `main`.
