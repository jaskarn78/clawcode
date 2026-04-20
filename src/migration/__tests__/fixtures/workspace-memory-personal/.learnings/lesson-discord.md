# Lesson: Discord Bot Setup

When the Discord plugin fails with EACCES, the likely cause is the
plugin's per-user config dir missing write permission. Fix: chown the
~/.claude-plugin directory to the daemon user.
