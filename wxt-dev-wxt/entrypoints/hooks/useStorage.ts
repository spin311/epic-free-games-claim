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

export async function getStorageItems(keys: string[], storageType: StorageValues = StorageValues.LOCAL) {
    const storageKeys: string[] = keys.map((key: string) => `${storageType}:${key}`);
    const items = await storage.getItems(storageKeys);
    return items.reduce((acc, item) => {
        const shortKey = item.key.split(":")[1];
        acc[shortKey] = item.value;
        return acc;
    }, {});
}

export async function mergeIntoStorageItem(
    key: string,
    newValue: any,
    storageType: StorageValues = StorageValues.LOCAL
) {
    const storageKey = `${storageType}:${key}`;
    const existingValue = await storage.getItem(storageKey);
    let updatedValue;
    if (existingValue == null || existingValue.length <= 0) {
        updatedValue = Array.isArray(newValue) ? newValue : [newValue];
    } else if (typeof existingValue === 'string' || typeof existingValue === 'number') {
        updatedValue = existingValue + newValue;
    } else if (Array.isArray(existingValue)) {
        updatedValue = [...existingValue, newValue];
    } else {
        throw new Error("mergeIntoStorageItem: Unsupported data type for appending.");
    }
    await storage.setItem(storageKey, updatedValue);
}