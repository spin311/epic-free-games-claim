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
        void storage.setItem(storageKey, value);
    }, [key, value]);

    return [value, setValue] as const;
}

export async function getStorageItem(key: string, storageType: StorageValues = StorageValues.LOCAL) {
    const storageKey = `${storageType}:${key}`;
    return storage.getItem(storageKey);
}

export function setStorageItem(key: string, value: any, storageType: StorageValues = StorageValues.LOCAL) {
    const storageKey = `${storageType}:${key}`;
    void storage.setItem(storageKey, value);
}

export async function getStorageItems(keys: string[], storageType: StorageValues = StorageValues.LOCAL) {
    const storageKeys: string[] = keys.map((key: string) => `${storageType}:${key}`);
    const items = await storage.getItems(storageKeys);
    return items.reduce((acc, item) => {
        const shortKey = item.key.split(":")[1];
        acc[shortKey] = item.value;
        return acc;
    }, {});
}