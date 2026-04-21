# ⛳ Golf Swing Analyzer

AI-powered golf swing analysis using your phone's front camera.

## Features

- **Real-time pose detection** — MediaPipe Pose tracks 33 body landmarks
- **Swing phase detection** — Automatically identifies setup, backswing, downswing, impact, and follow-through
- **Impact point estimation** — Predicts where the club face strikes the ball
- **Detailed scoring** — Each phase scored individually with an overall rating
- **Actionable feedback** — Specific issues and improvement tips

## How to Use

1. Open the app on your iPhone (Safari)
2. Allow camera access
3. Place your phone on a tripod facing you (face-on view)
4. Make sure your full body is visible
5. Tap **Start Recording**
6. Make your swing
7. Tap **Stop Recording**
8. Review your analysis!

## Deploy to GitHub Pages (Free)

### Step 1: Create a GitHub Repository

1. Go to [github.com](https://github.com) and log in
2. Click the **+** button → **New repository**
3. Name it `golf-swing-analyzer`
4. Set it to **Public**
5. Click **Create repository**

### Step 2: Push the Code

```bash
cd golf-swing-analyzer
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/golf-swing-analyzer.git
git push -u origin main
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages** (in the sidebar)
3. Under **Source**, select **main** branch and **/ (root)** folder
4. Click **Save**
5. Wait 1-2 minutes, then your app will be live at:
   `https://YOUR_USERNAME.github.io/golf-swing-analyzer/`

### Step 4: Open on iPhone

1. Open Safari on your iPhone
2. Go to your GitHub Pages URL
3. Tap the Share button → **Add to Home Screen**
4. Now it works like a native app!

## Tech Stack

- **MediaPipe Pose** — Real-time human pose estimation
- **Canvas API** — Skeleton overlay rendering
- **MediaRecorder API** — Video recording
- **Vanilla JavaScript** — No build tools needed

## Camera Setup

Best results with a **face-on view** (camera directly in front):

```
        📱 (your phone on tripod)
        |
        |  ~6-8 feet
        |
      🏌️ (you)
```

Make sure:
- Full body is visible (head to feet)
- Good lighting (outdoor or well-lit indoor)
- Stable phone mount (tripod recommended)

## Browser Support

- ✅ iOS Safari 14.5+
- ✅ Chrome (Android/Desktop)
- ✅ Firefox
- ⚠️ Some older browsers may not support MediaPipe WASM

## License

MIT
