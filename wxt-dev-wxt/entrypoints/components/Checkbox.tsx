function Checkbox(props: { checked: boolean, onChange: (e: any) => void, name: string }) {
    return <span>
                    <input
                        type="checkbox"
                        id={`${props.name}-checkbox`}
                        checked={props.checked}
                        onChange={props.onChange}
                    />
                    <label htmlFor={`${props.name}-checkbox`}>{props.name}</label>
            </span>;
}

export default Checkbox;