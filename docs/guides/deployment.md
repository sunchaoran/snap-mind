# Deployment Guide

## Target Environment

Mac mini, 本地常驻 Node.js 服务。

## Using PM2

```bash
# Install PM2
npm install -g pm2

# Start service
pm2 start dist/index.js --name clip-service

# Auto-restart on crash
pm2 save
pm2 startup

# Monitoring
pm2 status
pm2 logs clip-service
pm2 monit
```

## Using launchd (macOS native)

Create `~/Library/LaunchAgents/com.snapmind.clip-service.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.snapmind.clip-service</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/snap-mind/dist/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/clip-service.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/clip-service.err</string>
</dict>
</plist>
```

```bash
# Load
launchctl load ~/Library/LaunchAgents/com.snapmind.clip-service.plist

# Unload
launchctl unload ~/Library/LaunchAgents/com.snapmind.clip-service.plist
```

## Chrome Setup

确保 Chrome 浏览器保持以下平台的登录态（opencli Browser 模式依赖）：

- Twitter / X
- 小红书
- 微博
- 知乎
- Bilibili
- 豆瓣
