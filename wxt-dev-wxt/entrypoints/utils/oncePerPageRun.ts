export function oncePerPageRun(key: keyof Window): boolean {
    if (window[key]) return false;
    window[key] = true as never;
    return true;
}
