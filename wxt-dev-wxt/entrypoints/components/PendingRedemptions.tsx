import {useState} from "react";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {
    PENDING_REDEMPTIONS_STORAGE_KEY,
    PendingRedemption,
    pendingRedemptionKey,
} from "@/entrypoints/utils/pendingRedemptions.ts";

// Where an entry without a code was kept, and how to get there.
function codelessText(entry: PendingRedemption): { hint: string; link: string } {
    return entry.platform === "IndieGala"
        ? { hint: "Key wasn't read; it's on IndieGala.", link: "Open on IndieGala" }
        : { hint: "Code wasn't read; it's on Amazon's page.", link: "Open on Amazon" };
}

// Fallback for GOG/Microsoft codes the redeem content scripts couldn't
// auto-submit (not signed in, a captcha, already used, ...) — see
// recordRedeemFallback in pendingRedemptions.ts. Renders nothing when empty,
// so this is invisible on the common path where auto-redeem just works.
function PendingRedemptions() {
    const [pending, setPending] = useStorage<PendingRedemption[]>(PENDING_REDEMPTIONS_STORAGE_KEY, []);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    if (pending.length === 0) return null;

    async function handleCopy(code: string) {
        try {
            await navigator.clipboard.writeText(code);
            setCopiedCode(code);
            setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 1500);
        } catch (error: unknown) {
            console.error("[popup] clipboard copy failed:", error);
        }
    }

    function handleDismiss(key: string) {
        setPending(pending.filter((entry) => pendingRedemptionKey(entry) !== key));
    }

    return (
        <div className="pending-redemptions">
            <p className="pending-redemptions-title">Needs manual redeem</p>
            {pending.map((entry) => {
                const key = pendingRedemptionKey(entry);
                const codeless = codelessText(entry);
                return (
                    <div className="pending-redemption" key={key}>
                        <div className="pending-redemption-info">
                            <p className="pending-redemption-title">
                                {entry.title}
                                <span className="pending-redemption-platform"> ({entry.platform})</span>
                            </p>
                            {entry.code
                                ? <code className="pending-redemption-code">{entry.code}</code>
                                : <p className="hint">{codeless.hint}</p>}
                            {entry.reason && <p className="hint">{entry.reason}</p>}
                        </div>
                        <div className="pending-redemption-actions">
                            {entry.code && (
                                <button type="button" onClick={() => handleCopy(entry.code)}>
                                    {copiedCode === entry.code ? "Copied" : "Copy"}
                                </button>
                            )}
                            <a href={entry.redeemUrl} target="_blank" rel="noopener noreferrer">
                                {entry.code ? (entry.platform === "Steam" ? "Activate" : "Try again") : codeless.link}
                            </a>
                            <button type="button" onClick={() => handleDismiss(key)} aria-label="Dismiss">
                                &times;
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default PendingRedemptions;
