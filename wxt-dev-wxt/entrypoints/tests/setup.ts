import { fakeBrowser } from "wxt/testing";
import englishMessages from "@/public/_locales/en/messages.json";
import { Catalog, fakeGetMessage } from "@/entrypoints/tests/fakeI18n.ts";

// Every suite sees the English catalog, as an English browser would. Plain
// assignments rather than spies: vi.restoreAllMocks() must not undo them, and
// fakeBrowser.reset() leaves i18n alone.
fakeBrowser.i18n.getMessage = fakeGetMessage(englishMessages as Catalog) as typeof fakeBrowser.i18n.getMessage;
fakeBrowser.i18n.getUILanguage = () => "en-US";
