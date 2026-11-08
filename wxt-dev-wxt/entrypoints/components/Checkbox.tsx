import { ChangeEvent, ReactNode } from "react";

interface CheckboxProps {
    checked: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    name: string;
    // Needed when another checkbox in the popup has the same name (Prime
    // Gaming's "GOG" next to the GOG store): ids must be unique for the label.
    id?: string;
    // Optional content rendered after the label, flush to the row's right edge.
    trailing?: ReactNode;
}

function Checkbox({ checked, onChange, name, id, trailing }: CheckboxProps) {
    const inputId = id ?? `${name}-checkbox`;
    return <span className="check-row">
        <input type="checkbox" id={inputId} checked={checked} onChange={onChange}/>
        <label htmlFor={inputId}>{name}</label>
        {trailing}
    </span>;
}

export default Checkbox;
