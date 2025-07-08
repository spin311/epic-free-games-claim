import {useState, useEffect} from "react";

export function useStorage<T>(key: string, defaultValue: T, storage: storageValues = storageValues.LOCAL) {
    const [value, setValue] = useState<T>(defaultValue);
    const storageKey = `${storage}:${key}`;

    useEffect(() => {
        storage.getItem(storageKey).then((storageValue) => {
            if (storageValue !== undefined && storageValue !== defaultValue) setValue(storageValue);
        });
    }, [key]);

    useEffect(() => {
        storage.setItem(storageKey, value);
    }, [key, value]);

    return [value, setValue] as const;
}