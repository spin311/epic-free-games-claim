import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
    AccessGroup,
    AccessToggle,
    hasAccessFor,
    PENDING_ACCESS_REQUEST_KEY,
    readGrantedAccessGroups,
    toggleWithAccess,
} from "@/entrypoints/utils/optionalAccess.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";

// The optional host groups granted right now, kept live while the popup is
// open: a grant can land after the prompt closes, and a revoke can come from
// the browser's own extension settings. Until the first read resolves nothing
// counts as granted, so a feature never shows on before its access is known.
export function useOptionalAccess() {
    const [granted, setGranted] = useState<ReadonlySet<AccessGroup>>(() => new Set());

    useEffect(() => {
        let isSubscribed = true;
        const refresh = () => {
            readGrantedAccessGroups(browser.permissions)
                .then((groups) => { if (isSubscribed) setGranted(groups); })
                .catch((e) => console.error("Reading optional host access failed:", e));
        };
        refresh();
        browser.permissions.onAdded.addListener(refresh);
        browser.permissions.onRemoved.addListener(refresh);
        return () => {
            isSubscribed = false;
            browser.permissions.onAdded.removeListener(refresh);
            browser.permissions.onRemoved.removeListener(refresh);
        };
    }, []);

    return {
        // What a checkbox shows: its flag AND its hosts granted.
        isOn: (toggle: AccessToggle, flag: boolean) => flag && hasAccessFor(toggle, granted),
        // Call first thing in the change handler — see toggleWithAccess.
        setWithAccess: (toggle: AccessToggle, checked: boolean, setFlag: (value: boolean) => void) =>
            toggleWithAccess(toggle, checked, setFlag, browser.permissions,
                (request) => void setStorageItem(PENDING_ACCESS_REQUEST_KEY, request)),
    };
}
