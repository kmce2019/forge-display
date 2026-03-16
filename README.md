# IdleScreens Pro v1.6

This build includes:

- sqlite3-backed storage instead of better-sqlite3
- startup via systemd service
- one-command installer
- live screen previews
- scheduled playlists by time of day
- separate Menus and Announcements admin pages
- crawler speed controls
- breakfast and lunch menu support
- PDF, image, and video assets
- per-screen themes and playlist assignment

## Fast install on Ubuntu/Debian

1. Extract the zip.
2. Run:

```bash
cd idlescreens-pro-mvp
sudo bash install.sh
```

Then open:

```text
http://SERVER-IP:3010/admin
```

## Manual dev run

```bash
npm install
PORT=3010 npm start
```

## Service commands

```bash
sudo systemctl status idlescreens-pro
sudo journalctl -u idlescreens-pro -f
sudo systemctl restart idlescreens-pro
```

## Notes

- Default app port is `3010`
- Uploaded assets live in `uploads/`
- SQLite database lives in `data/idlescreens.db`
- Branding, schedules, menus, announcements, and playlists are stored in SQLite
