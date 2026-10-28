<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

<div align="center">
# Folia KTV

Home Karaoke // 家庭 KTV

Folia KTV is a home-karaoke adaptation of the Folia desktop player. It adds segmented accompaniment generation during playback, original-vocal / accompaniment switching, GPU-first vocal separation with automatic CPU fallback, and a phone QR page for searching and queuing songs over the local network.

**Original author and upstream:** [@chthollyphile](https://github.com/chthollyphile) · [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major). This is a community adaptation. It preserves Folia's AGPL-3.0 license and upstream attribution. See this repository's KTV guide for the added features. Thanks to the original author and the Folia community.

[简体中文](README.md) | [English](README.en.md)

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[Development](#development)
·
[Home KTV guide](docs/ktv-home.md)
·
[Upstream Folia guide](https://folia-site.cielaniska.top/guide/)
·
[Technical Notes](docs/technical.md)

</div>

## About

Folia KTV is a home-karaoke desktop app built on the immersive lyrics player Folia. It retains upstream support for NetEase Cloud Music, Kugou, QQ Music, Navidrome, and local music libraries, and adds segmented accompaniment generation while a song plays. Switch between the original vocal and generated accompaniment, or use the phone QR page to search, queue songs, and control playback over the local network.

Vocal separation prefers available GPU acceleration and automatically falls back to CPU if the GPU is unavailable or inference fails. Segments that are not ready continue playing the original audio; processing speed depends on the device and audio source.

KTV playback and the phone QR room require the Electron desktop app. The inherited web app does not include the desktop LAN queue service.

## Development

Requires Node.js 24 or later. From the project directory, run:

```powershell
npm ci
npm run models:fetch
npm run dev:electron
```

`models:fetch` downloads and verifies the vocal-separation models. See the [Windows portable package guide](packaging/windows/README-PORTABLE.txt) to build a portable version. This repository contains source code, not a Windows portable binary; upstream Folia installers do not include this KTV adaptation.

## Showcase

![visualizer](./img/visualizer.png)

### Demo videos

https://github.com/user-attachments/assets/af806cf1-f67f-4b88-b2e7-57db507e9e81

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### Selected styles

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Luminous preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Fume</strong></td>
    <td align="center"><strong>Luminous</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Mindscape preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Partita preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Mindscape</strong></td>
    <td align="center"><strong>Partita</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="Cappella preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Cappella</strong></td>
    <td align="center"><strong>Tilt</strong></td>
  </tr>
    <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="Diorama preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="Pendolo preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Diorama</strong></td>
    <td align="center"><strong>Pendolo</strong></td>
  </tr>
</table>

Each lyric animation has its own typography, mood, and tunable parameters, giving full-screen lyrics the richness of a lyric video while staying responsive to any window size.

## Features

| Feature | Description |
| --- | --- |
| Online search and playback | Search for songs, artists, or albums and play them; covers and lyrics load automatically. |
| Local music | Import local audio files. Folia stores the index locally and never uploads file contents. See [Local Library Management](docs/local-library-management.md) (Chinese). |
| Home KTV | The desktop app generates accompaniment for the current song in segments and switches between vocals and instrumental; phones can scan a LAN QR code to search and request songs. See the [Home KTV guide](docs/ktv-home.md) (Chinese). |
| Smart lyric matching | Local songs are matched to online lyrics and covers automatically; you can correct matches by hand. |
| Local lyric files | Loads `.lrc`, `.vtt`, `.ttml`, `.qrc`, `.yrc`, and `.krc` files with the same name in the same folder, as well as embedded LRC lyrics. Supports the enhanced word-by-word formats produced by LDDC. |
| Now Playing integration | Connects to a local [Now Playing](https://github.com/Widdit/now-playing-service/) service to take song, timeline, and lyric data from external players and drive Folia's stage view and full-screen lyrics. |
| AI themes | Generates immersive backgrounds and visual parameters from a song's mood and lyrics. |
| Multi-platform | Deploy as a web app or install the packaged desktop app. |
| Mods (experimental) | On desktop, Folium mods can add lyric animations, backgrounds, player-page layers, commands, and more. Install officially verified mods from the [mod market](https://folium-compound.cielaniska.top). See [Mods](#mods-folium-v1x). |

## Deployment and releases

The desktop app bundles both frontend and backend, so it works right after install.

### One-click deployment

To deploy the inherited Folia web player, follow the [Vercel deployment guide](https://folia-site.cielaniska.top/guide/deploy-vercel). KTV playback and phone QR queuing are available only in the desktop app.

Folia also deploys to Cloudflare in one click; adapt the Vercel guide accordingly.

On Vercel and Cloudflare, QQ Music no longer needs a separate, always-on API instance: set `VITE_QQ_API_BASE` to `/api/qq` and add a `QQ_SESSION_SECRET` (a server-side secret, **without the `VITE_` prefix**). This setup supports login by scanning a QR code with WeChat or mobile QQ (mobile QQ requires qq-music-api 3.3.3 or later), and you must log in before playback. On Cloudflare you can also bind a Durable Object so QQ QR login uses a long-lived connection and gains QR login with the QQ Music app. For full steps, platform differences, and troubleshooting, see the [QQ Music deployment guide](docs/qq-music-deployment.md) (Chinese).

Self-hosters can use the [Docker Compose full-stack deployment](deploy/docker/README.md). Access to local music folders requires a trusted HTTPS secure context; the deployment docs cover NAS reverse proxies and certificate requirements.

### Direct download

This repository currently contains source code and does not include a Windows portable binary. Run the development commands above or build one using the [Windows portable package guide](packaging/windows/README-PORTABLE.txt). Upstream Folia installers do not contain this project's KTV changes.

For Linux packages, the Wayland / Hyprland remote control window, and other desktop details, see [Technical Notes](docs/technical.md) (Chinese).

### Mobile

| Option | Details |
| --- | --- |
| **PWA (recommended)** | Deploy the web or self-hosted version, then add it to your home screen from Chrome for Android or iOS Safari to use it as a PWA. |
| **Community ports (Android)** | [maimai993/folia-sonnet](https://github.com/maimai993/folia-sonnet) · [whycfawa/folia-android](https://github.com/whycfawa/folia-android) |
| **Build it yourself (Android)** | If you are comfortable with the tooling, package the web version as an installable APK with Capacitor. See the example repository [chthollyphile/folia-sonnet](https://github.com/chthollyphile/folia-sonnet). |

> [!NOTE]
> Community ports are third-party projects maintained independently by the community, and their features differ from the official desktop version. Please report any issues to the corresponding repository.

## Documentation and development

For the full user guide, visit [Folia Guide](https://folia-site.cielaniska.top/guide/).

Deployment, environment variables, local development, the Stage API, common scripts, and the tech stack are covered in [Technical Notes](docs/technical.md) (Chinese).

Before contributing, read the [Contributing Guide](CONTRIBUTING.en.md).

## Mods (Folium v1.x)

> [!NOTE]
> Mods are experimental, available in the desktop app only, and off by default. Turn them on in **Settings → Mods → Mod system**.

Folium is Folia's mod platform. Mods can add lyric animation modes and background types, overlay content on the player page, add buttons and markers to the progress bar, register commands and settings sections, rewrite lyrics before they are displayed, and use native capabilities such as ffmpeg through a Node entry point. Mods run as trusted code: you confirm each mod in a native window before it is enabled, and confirm again after its files change.

- **Mod market**: [folium-compound.cielaniska.top](https://folium-compound.cielaniska.top) hosts official mods and reviewed community mods. Download the zip and drag it into the Mods panel to install.
- **Verification**: Every mod in the market carries a Folium signature and shows as **Verified** after install. Early-access mods that passed only the security review show as **Preview**. Third-party mods without a signature show as **Unverified** and still work.
- **Developing and contributing**: The [mod development and contribution guide](docs/folium/contributing.md) walks from your first mod and local debugging through submitting to the market, review and signing, and publishing updates.
- **API reference**: The [Folium API reference](docs/folium/api.md) is generated from the contract file and organized by registries, contexts, events, and services.
- **Platform spec**: The [Folium spec](mods/README.md) covers manifest fields, permissions, registry semantics, events, the security model, and versioning.
- **Example mods**: The repository's [`mods/`](mods/) folder covers lyric animations, tuning, the progress bar, player-page layers, and transparent video export.

## Sync Server

Folia offers an optional official sync server, `sync-server`, that syncs appearance settings and the AI theme library across devices. You host it yourself; it suits anyone who wants their color themes on every device.

Deployment options:

- **Cloudflare Workers / D1**: Serverless, no servers to maintain. Recommended.
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**: See the [Docker deployment folder](deploy/docker/README.md) for the image and Compose setup.
- **Self-hosted Node.js**: Uses SQLite; suits local machines or environments where Docker is inconvenient.

For environment variables, token setup, and deployment steps, see the [Sync Server deployment guide](https://folia-site.cielaniska.top/guide/deploy-sync). Once deployed, enter the server URL and `SYNC_TOKEN` in **Settings → Connections** to turn on sync.

## Local music and matching

Folia reads audio metadata plus lyrics and covers from the same folder, and can fill in song details from NetEase Cloud Music, QQ Music, or Kugou. Automatic matching tries NetEase, then QQ, then Kugou. When a match is wrong, you can pick another candidate, restore the local data from the first import, or merge and split artist and album entries.

For importing, rescanning, matching, entry editing, playlists, caching, and troubleshooting, see [Local Library Management](docs/local-library-management.md) (Chinese).

## Community

Join the Discord to chat and get help.

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## Contributors

Thanks to everyone who has filed issues, reported bugs, suggested ideas, tested, or written code. Contributions are tracked under the all-contributors specification.

The list is long, so see [Contributors](CONTRIBUTORS.md).

## Legal and disclaimer

This project was developed with extensive AI assistance and may still contain subtle or hard-to-spot problems. We apologize for any inconvenience.

The project mainly showcases playback animation, interface design, and the engineering behind them. Copyright in the online streams, lyrics, album art, and other content shown in the app belongs to the respective rights holders.

This repository and its source code are for personal study, technical exchange, and non-profit testing only. Do not use them for commercial purposes. Users bear sole responsibility for any copyright dispute or other liability arising from distributing, modifying, or redistributing online resources; the developers accept no liability.

Please respect digital rights and support licensed music through official platforms whenever you can.

## Acknowledgements

Special thanks to these projects and resources:

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
- [paper-design/shaders](https://github.com/paper-design/shaders)
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)

Folia uses the [Apple Music-like Lyrics TTML word-by-word lyrics database](https://github.com/amll-dev/amll-ttml-db) for high-quality lyric files. Thanks to its authors and contributors.

## License

Folia is open source under the `AGPL-3.0` license.
