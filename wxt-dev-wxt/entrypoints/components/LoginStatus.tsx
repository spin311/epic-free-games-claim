import { LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

interface LoginStatusProps {
    state: LoginState;
    loginUrl: string;
    platform: Platforms;
}

// Asks the background to recheck this one platform's login state — a
// deliberate response to the user clicking "Log in", so unlike the automatic
// startup/alarm path it isn't throttled (see checkPlatformLogin). Opening the
// login page itself is left to the <a>'s own href/target — this only adds a
// side effect alongside that default navigation, not instead of it.
function requestLoginRecheck(platform: Platforms) {
    browser.runtime.sendMessage({ action: "checkPlatformLogin", target: "background", data: { platform } });
}

// Only a confirmed `true` (an actual claim run detected a signed-in session)
// shows "Logged in" — everything else, including the unknown/never-checked
// state a fresh install starts in, shows the "Log in" prompt. Claiming never
// happens as a side effect of installing or of enabling a platform (see
// background.ts's handleInstall), so without this a freshly enabled platform
// would show nothing at all until the next scheduled check — a "Log in"
// nudge is more useful than no signal, and it's never wrong to suggest.
function LoginStatus({ state, loginUrl, platform }: LoginStatusProps) {
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
