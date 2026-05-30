import { create } from "zustand";

interface MFAModalState {
  open: boolean;
  username: string;
  mobileHint: string;
  methodCode: string;
  mfaMethod: "sms" | "cpdaily" | "weixin";
  resolve: ((value: string) => void) | null;
  reject: (() => void) | null;
  showMFA: (opts: {
    username: string;
    method?: "sms" | "cpdaily" | "weixin";
  }) => Promise<string>;
  setMethodInfo: (method: "sms" | "cpdaily" | "weixin", methodCode: string, mobileHint: string) => void;
  submitMFA: (code: string) => void;
  completeWechatMFA: () => void;
  cancelMFA: () => void;
  resetState: () => void;
}

export const useMFAModalStore = create<MFAModalState>((set, get) => ({
  open: false,
  username: "",
  mobileHint: "",
  methodCode: "",
  mfaMethod: "weixin",
  resolve: null,
  reject: null,

  showMFA: (opts) =>
    new Promise((resolve, reject) => {
      set({
        open: true,
        username: opts.username,
        methodCode: "",
        mobileHint: "",
        mfaMethod: opts.method ?? "weixin",
        resolve,
        reject,
      });
    }),

  setMethodInfo: (method, methodCode, mobileHint) => {
    set({ mfaMethod: method, methodCode, mobileHint });
  },

  submitMFA: (code) => {
    const { resolve } = get();
    if (resolve) resolve(code);
    set({ open: false, resolve: null, reject: null });
  },

  completeWechatMFA: () => {
    const { resolve } = get();
    if (resolve) resolve('');
    set({ open: false, resolve: null, reject: null });
  },

  cancelMFA: () => {
    const { reject } = get();
    if (reject) reject();
    set({ open: false, resolve: null, reject: null });
  },

  resetState: () => {
    set({
      open: false,
      username: "",
      mobileHint: "",
      methodCode: "",
      mfaMethod: "weixin",
      resolve: null,
      reject: null,
    });
  },
}));
