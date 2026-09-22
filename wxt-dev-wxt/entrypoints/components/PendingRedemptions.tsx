import {useState} from "react";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {PENDING_REDEMPTIONS_STORAGE_KEY, PendingRedemption} from "@/entrypoints/utils/pendingRedemptions.ts";

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

    function handleDismiss(code: string) {
        setPending(pending.filter((entry) => entry.code !== code));
    }

    return (
        <div className="pending-redemptions">
            <p className="pending-redemptions-title">Needs manual redeem</p>
            {pending.map((entry) => (
                <div className="pending-redemption" key={entry.code}>
                    <div className="pending-redemption-info">
                        <p className="pending-redemption-title">
                            {entry.title}
                            <span className="pending-redemption-platform"> ({entry.platform})</span>
                        </p>
                        <code className="pending-redemption-code">{entry.code}</code>
                    </div>
                    <div className="pending-redemption-actions">
                        <button type="button" onClick={() => handleCopy(entry.code)}>
                            {copiedCode === entry.code ? "Copied" : "Copy"}
                        </button>
                        <a href={entry.redeemUrl} target="_blank" rel="noopener noreferrer">Try again</a>
                        <button type="button" onClick={() => handleDismiss(entry.code)} aria-label="Dismiss">
                            &times;
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default PendingRedemptions;
