import { ChangeEvent, ReactNode } from "react";

interface CheckboxProps {
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    name: string;
    // Optional content rendered after the label, flush to the row's right edge.
    trailing?: ReactNode;
    disabled?: boolean;
}

function Checkbox({ checked, onChange, name, trailing, disabled = false }: CheckboxProps) {
    return <span className={disabled ? 'is-disabled' : undefined}>
                    <input
                        type="checkbox"
                        id={`${name}-checkbox`}
                        checked={checked}
                        onChange={onChange}
                        disabled={disabled}
                    />
                    <label htmlFor={`${name}-checkbox`}>{name}</label>
                    {trailing}
            </span>;
}

export default Checkbox;
