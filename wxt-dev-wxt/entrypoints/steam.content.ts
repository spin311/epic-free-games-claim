export default defineContentScript({
    matches: ['https://store.steampowered.com/*'],
    main(_) {
        console.log('Steam content script running');
    },
});
