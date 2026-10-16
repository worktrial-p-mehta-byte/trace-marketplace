# Follow along on your own computer

You get your own copy of the marketplace with a synthetic demo market. Nothing
you do touches anyone else's copy, so try everything.

## 1. Set it up (one line, about 3 minutes)

On **macOS or Linux**, open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/worktrial-p-mehta-byte/trace-marketplace/main/scripts/try-it.sh | bash
```

On **Windows**, paste the same line into WSL (Ubuntu).

Your browser opens on the marketplace when it's ready. You don't need to
install anything first: if your Node.js is missing or old, the script
downloads a private copy into the project folder (`~/trace-marketplace`).
Nothing is installed elsewhere, and no admin password is needed.

Leave the Terminal window open while you follow along. **Ctrl+C** stops the
site. Paste the same line again to start over with a fresh demo.

## 2. Follow along

| Step               | What to do                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Share**          | **Create account** as a seller, then accept the terms. **Choose files** and pick `10-domain-medical`, `11-domain-data`, `12-authenticity-suspect` and `09-everything` from `~/trace-marketplace/demo/seller-sessions`. |
| **Review**         | Click each session. See what it was about, whether it looks authentic, and its price with the reasons. Then **Share**: session 10 is bought by a lab's campaign straight away.                                         |
| **Search and buy** | In a private window, sign in as `buyer@example.com` (password `demo-password`). **Browse traces**, describe what you need in plain words, open a result, and **Buy**.                                                  |
| **Campaigns**      | **Campaigns**: the lab's standing bids, and what they have bought so far.                                                                                                                                              |
| **Trends**         | Back in the seller window: **Trends** shows what buyers want, and the bell shows your sale.                                                                                                                            |
| **Play**           | **Market simulator**: post a bounty, add sessions, and watch prices move.                                                                                                                                              |

The presenter's full script is in [DEMO.md](DEMO.md).

## If something goes wrong

| Problem                                            | Fix                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| "Setup stopped: …"                                 | Paste the line again (it is safe to repeat). If it stops the same way, show the presenter the last lines it printed. |
| The browser didn't open                            | Open the address the script printed, e.g. `http://localhost:3000`.                                                   |
| Port 3000 is in use                                | Nothing to do: the script uses the next free port and prints it.                                                     |
| "You have already shared this session"             | Paste the line again for a fresh demo.                                                                               |
| Sign-in doesn't stick                              | Use `localhost` in the address, not `127.0.0.1` or an IP address.                                                    |
| `~/trace-marketplace` exists and is something else | Choose another folder: put `TM_DIR=~/tm-demo` before `bash` at the end of the line.                                  |
