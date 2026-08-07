import { ChangeEvent, ReactNode } from "react";

interface CheckboxProps {
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    name: string;
    // Optional content rendered after the label, flush to the row's right edge.
    trailing?: ReactNode;
}

function Checkbox({ checked, onChange, name, trailing }: CheckboxProps) {
    return <span>
                    <input
                        type="checkbox"
                        id={`${name}-checkbox`}
                        checked={checked}
                        onChange={onChange}
                    />
                    <label htmlFor={`${name}-checkbox`}>{name}</label>
                    {trailing}
            </span>;
}

export default Checkbox;
