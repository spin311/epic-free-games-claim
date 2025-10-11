# Free Game Claimer for Steam & Epic

![claimer-promo-img](/imgs/claimer-promo-img.png)

Automatically claim free games from Steam and Epic Games Store with a browser extension.  
This project helps users discover and claim free games with minimal effort.

## Features

- **Automatic Claiming:** Claims free games on a chosen day of the week.
- **Manual Claim:** Instantly claim available free games with a button.
- **Platform Selection:** Enable/disable Steam or Epic Games checks.
- **Games List:** View all currently available free games.
- **Counter:** Track the number of games claimed.
- **React UI:** Modern, responsive popup interface.

## Technologies

- TypeScript & JavaScript
- React 19
- WXT (Web Extension Toolkit)
- Browser APIs (storage, tabs, scripting)

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm
- wxt CLI

### Installation

1. Clone the repository:

git clone https://github.com/spin311/epic-free-games-claim.git cd epic-free-games-claim/wxt-dev-wxt

2. Install dependencies:
   
`npm install`

3. Start development mode:

`run dev -- --browser=chrome` or `run dev -- --browser=firefox`

4. Build for production:

`npx wxt build --browser=chrome` or `wxt build -b firefox --mv3 ` 

### Load Extension

- Load the `dist` or zipped build into your browser's extensions page (e.g., Chrome or Firefox).

## Usage

- Open the extension popup.
- Configure your preferred platforms and claim day.
- Click "Manually claim" to fetch and claim free games instantly.
- Switch to the "Free Games" tab to view all available free games.

## Contributing

Pull requests and issues are welcome!  
Please follow conventional code styles and test new version before submitting pull request.

## License

MIT



