export default defineContentScript({
    matches: ['https://store.epicgames.com/*'],
    main(ctx) {
        ctx.addListener('message', (message) => {})
    },
});