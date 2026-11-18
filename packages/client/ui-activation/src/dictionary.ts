import { defineDictionary } from "@orahako/sdk"

export const activationDictionary = defineDictionary({
  zh: {
    activation: {
      title: "激活应用",
      description: "当前应用仅限个人小范围使用，请输入激活密钥后使用。",
      placeholder: "激活密钥",
      submit: "激活",
      verifying: "验证中...",
      invalid: "密钥不正确，请检查后重试",
      networkError: "验证失败，请检查网络后重试",
    },
  },
  en: {
    activation: {
      title: "Activate App",
      description:
        "The web version is for limited use only. Enter your activation key to continue.",
      placeholder: "Activation key",
      submit: "Activate",
      verifying: "Verifying...",
      invalid: "Invalid key, please check and try again",
      networkError: "Verification failed, please check your network and try again",
    },
  },
})

export type ActivationDictionary = typeof activationDictionary
