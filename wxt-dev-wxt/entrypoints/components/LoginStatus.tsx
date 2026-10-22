import { LoginState } from "@/entrypoints/utils/loginState.ts";

interface LoginStatusProps {
    state: LoginState;
}

// Renders nothing until a claim run has actually determined the state: an
// unknown session must not be presented as a signed-out one.
function LoginStatus({ state }: LoginStatusProps) {
    if (state === null) return null;

    const label = state ? "Logged in" : "Not logged in";

    return (
        <span
            className={`login-status ${state ? "logged-in" : "logged-out"}`}
            title={
                state
                    ? "Signed in as of the last claim run"
                    : "Not signed in as of the last claim run — free games can't be claimed"
            }
        >
            <span className="login-dot" aria-hidden="true"/>
            {label}
        </span>
    );
}

export default LoginStatus;
