import {useState, useEffect} from "react";
import {StorageValues} from "@/entrypoints/enums/storageValues.ts"
import { storage } from '#imports';

export function useStorage<T>(key: string, defaultValue: T, storageType: StorageValues = StorageValues.LOCAL) {
    const storageKey = `${storageType}:${key}`;
    const [value, setValue] = useState<T>(defaultValue);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        storage.getItem(storageKey).then((stored) => {
            setValue(stored ?? defaultValue);
            setIsInitialized(true);
        });
    }, [storageKey]);

    useEffect(() => {
        if (isInitialized) {
            void storage.setItem(storageKey, value);
        }
    }, [storageKey, value, isInitialized]);

    return [value, setValue] as const;
}

export async function getStorageItem(key: string, storageType: StorageValues = StorageValues.LOCAL) {
    const storageKey = `${storageType}:${key}`;
    return await storage.getItem(storageKey);
}

export async function setStorageItem(key: string, value: any, storageType: StorageValues = StorageValues.LOCAL) {
    const storageKey = `${storageType}:${key}`;
    await storage.setItem(storageKey, value);
}

export async function setStorageItems(items: Record<string, any>, storageType: StorageValues = StorageValues.LOCAL) {
    const storageItems = Object.entries(items).map(([key, value]) => ({
        key: `${storageType}:${key}`,
        value
    }));
    await storage.setItems(storageItems);
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

function asAppendItems<T>(v: T | T[]): T[] {
    return Array.isArray(v) ? v : [v];
}

export async function mergeIntoStorageItem<T>(
    key: string,
    newValue: T | T[],
    storageType: StorageValues = StorageValues.LOCAL
) {
    const storageKey = `${storageType}:${key}`;
    const existingValue = await storage.getItem(storageKey);

    let updatedValue: unknown;

    // 1) Nothing stored yet → make an array from newValue
    if (existingValue == null) {
        updatedValue = asAppendItems(newValue);

        // 2) Existing is an array → append (deconstruct only if newValue is an array)
    } else if (Array.isArray(existingValue)) {
        updatedValue = existingValue.concat(asAppendItems(newValue));

        // 3) Existing is a string → concat as string
    } else if (typeof existingValue === 'string') {
        updatedValue = existingValue + String(newValue);

        // 4) (Optional) keep number-concat like your original
    } else if (typeof existingValue === 'number') {
        // This mirrors your previous behavior; switch to String(...) if you prefer string concatenation.
        updatedValue = (existingValue as number) + (newValue as any);

    } else {
        throw new Error('mergeIntoStorageItem: Unsupported data type for appending.');
    }

    await storage.setItem(storageKey, updatedValue);
}