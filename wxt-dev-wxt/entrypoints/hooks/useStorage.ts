import {useState, useEffect} from "react";
import {StorageValues} from "@/entrypoints/enums/storageValues.ts"
import { storage } from '#imports';

export function useStorage<T>(key: string, defaultValue: T, storageType: StorageValues = StorageValues.LOCAL) {
    const [value, setValue] = useState<T>(defaultValue);
    const storageKey = `${storageType}:${key}`;

    useEffect(() => {
        storage.getItem(storageKey).then((storageValue) => {
            setValue(storageValue ?? defaultValue);
        });
    }, [key]);

    useEffect(() => {
        storage.setItem(storageKey, value);
    }, [key, value]);

    return [value, setValue] as const;
}