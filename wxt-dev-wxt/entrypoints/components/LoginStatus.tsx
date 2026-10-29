import { LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

interface LoginStatusProps {
    state: LoginState;
    loginUrl: string;
    platform: Platforms;
    // Signed in, but the account itself can't claim (Prime Gaming without a
    // Prime membership): shown in place of "Logged in".
    accountWarning?: { label: string; title: string } | null;
}

// Asks the background to recheck this one platform's login state — a
// deliberate response to the user clicking "Log in", so unlike the automatic
// startup/alarm path it isn't throttled (see checkPlatformLogin). Opening the
// login page itself is left to the <a>'s own href/target — this only adds a
// side effect alongside that default navigation, not instead of it.
function requestLoginRecheck(platform: Platforms) {
    browser.runtime.sendMessage({ action: "checkPlatformLogin", target: "background", data: { platform } });
}

// Only a confirmed `true` (a check or a visit to the store saw a signed-in
// session) shows "Logged in" — everything else, including the unknown state
// before anything has checked, shows the "Log in" prompt. Clicking it also
// asks the background to recheck, so a user who is already signed in sees
// "Logged in" from then on.
function LoginStatus({ state, loginUrl, platform, accountWarning }: LoginStatusProps) {
    if (state === true && accountWarning) {
        return (
            <span className="login-status account-warning" title={accountWarning.title}>
                <span className="login-dot" aria-hidden="true"/>
                {accountWarning.label}
            </span>
        );
    }
    if (state === true) {
        return (
            <span className="login-status logged-in" title="Signed in as of the last claim run">
                <span className="login-dot" aria-hidden="true"/>
                Logged in
            </span>
        );
    }

    return (
        <a
            className="login-status logged-out"
            href={loginUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => requestLoginRecheck(platform)}
            title={
                state === false
                    ? "Not signed in as of the last claim run — free games can't be claimed. Click to log in."
                    : "Not checked yet — click to log in."
            }
        >
            <span className="login-dot" aria-hidden="true"/>
            Log in
        </a>
    );
}

export default LoginStatus;
