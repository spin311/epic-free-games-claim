import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { useOptionalAccess } from "@/entrypoints/hooks/useOptionalAccess.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { EXTERNAL_PLATFORM_DEFAULTS, EXTERNAL_PLATFORM_STORAGE_KEYS } from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { LEGACY_EMAIL_STORAGE_KEY, normalizeEmail } from "@/entrypoints/utils/legacyGamesRedeem.ts";

function PrimeGamingSettings() {
    // Off by default (see spec: IndieGala and Prime Gaming both start disabled
    // on install) — existing installs keep whatever they already had stored.
    const [primeGamingCheck, setPrimeGamingCheck] = useStorage<boolean>("primeGamingCheck", false);
    // Defaults per EXTERNAL_PLATFORM_DEFAULTS: Amazon Games App on, the rest
    // opt-in — claiming those means navigating to that store's own account
    // and possibly its account-linking flow.
    const [claimEpic, setClaimEpic] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Epic, EXTERNAL_PLATFORM_DEFAULTS.Epic);
    const [claimGog, setClaimGog] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.GOG, EXTERNAL_PLATFORM_DEFAULTS.GOG);
    const [claimWindows, setClaimWindows] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Windows, EXTERNAL_PLATFORM_DEFAULTS.Windows);
    const [claimAmazonGames, setClaimAmazonGames] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.AmazonGames, EXTERNAL_PLATFORM_DEFAULTS.AmazonGames);
    const [claimLegacy, setClaimLegacy] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Legacy, EXTERNAL_PLATFORM_DEFAULTS.Legacy);
    // Each checkbox shows its flag AND its hosts: a store-linked offer also
    // needs the store's own hosts, where our script redeems its code.
    const access = useOptionalAccess();
    const isPrimeOn = access.isOn("primeGamingCheck", primeGamingCheck);
    const isEpicOn = access.isOn(EXTERNAL_PLATFORM_STORAGE_KEYS.Epic, claimEpic);
    const isGogOn = access.isOn(EXTERNAL_PLATFORM_STORAGE_KEYS.GOG, claimGog);
    const isWindowsOn = access.isOn(EXTERNAL_PLATFORM_STORAGE_KEYS.Windows, claimWindows);
    const isAmazonGamesOn = access.isOn(EXTERNAL_PLATFORM_STORAGE_KEYS.AmazonGames, claimAmazonGames);
    const isLegacyOn = access.isOn(EXTERNAL_PLATFORM_STORAGE_KEYS.Legacy, claimLegacy);
    const isNothingPicked = !(isEpicOn || isGogOn || isWindowsOn || isAmazonGamesOn || isLegacyOn);
    // Stored as typed; legacygames.content.ts only submits it once it parses
    // as an email, and otherwise fills in the code alone.
    const [legacyEmail, setLegacyEmail] = useStorage<string>(LEGACY_EMAIL_STORAGE_KEY, "");
    const isLegacyEmailInvalid = legacyEmail.trim() !== "" && normalizeEmail(legacyEmail) === null;
    const [primeGamingLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.PrimeGaming], null);

    return (
        <div className="platform-group">
            <Checkbox name="Prime Gaming" checked={isPrimeOn} onChange={e => access.setWithAccess("primeGamingCheck", e.target.checked, setPrimeGamingCheck)}
                      trailing={isPrimeOn && <LoginStatus state={primeGamingLoggedIn} loginUrl="https://gaming.amazon.com/home" platform={Platforms.PrimeGaming}/>}/>
            {isPrimeOn && (
                <div className="sub-options">
                    <p className="hint">Claim offers that go to:</p>
                    <Checkbox name="Amazon Games App offers" checked={isAmazonGamesOn}
                              onChange={e => access.setWithAccess(EXTERNAL_PLATFORM_STORAGE_KEYS.AmazonGames, e.target.checked, setClaimAmazonGames)}/>
                    <Checkbox name="Epic-linked offers" checked={isEpicOn}
                              onChange={e => access.setWithAccess(EXTERNAL_PLATFORM_STORAGE_KEYS.Epic, e.target.checked, setClaimEpic)}/>
                    <Checkbox name="GOG-linked offers" checked={isGogOn}
                              onChange={e => access.setWithAccess(EXTERNAL_PLATFORM_STORAGE_KEYS.GOG, e.target.checked, setClaimGog)}/>
                    <Checkbox name="Windows-linked offers" checked={isWindowsOn}
                              onChange={e => access.setWithAccess(EXTERNAL_PLATFORM_STORAGE_KEYS.Windows, e.target.checked, setClaimWindows)}/>
                    <Checkbox name="Legacy Games offers" checked={isLegacyOn}
                              onChange={e => access.setWithAccess(EXTERNAL_PLATFORM_STORAGE_KEYS.Legacy, e.target.checked, setClaimLegacy)}/>
                    {isNothingPicked && (
                        <p className="hint">Every Prime offer goes to one of these, so nothing is claimed until you pick one.</p>
                    )}
                    {isLegacyOn && (
                        <div className="legacy-email">
                            <label htmlFor="legacy-games-email">Legacy Games email</label>
                            <input
                                id="legacy-games-email"
                                type="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                value={legacyEmail}
                                aria-invalid={isLegacyEmailInvalid}
                                onChange={e => setLegacyEmail(e.target.value)}
                            />
                            <p className="hint">
                                {isLegacyEmailInvalid
                                    ? "Not a valid email; codes will be filled in for you to finish."
                                    : "Codes are redeemed to this email (no newsletter). Leave empty to finish each one yourself."}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default PrimeGamingSettings;
