export const generateRandomString = (length = 16) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
};

const getKeyMaterial = async (password: string) => {
  const enc = new TextEncoder();
  return window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
};

const getDerivationKey = async (keyMaterial: CryptoKey, salt: Uint8Array) => {
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptData = async (data: string, password: string): Promise<{ encrypted: string; salt: string; iv: string }> => {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const keyMaterial = await getKeyMaterial(password);
  const key = await getDerivationKey(keyMaterial, salt);
  
  const encoded = new TextEncoder().encode(data);
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encoded
  );

  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv))
  };
};

export const decryptData = async (encryptedData: string, password: string, saltStr: string, ivStr: string): Promise<string> => {
  const salt = new Uint8Array(atob(saltStr).split('').map(c => c.charCodeAt(0)));
  const iv = new Uint8Array(atob(ivStr).split('').map(c => c.charCodeAt(0)));
  const encrypted = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));

  const keyMaterial = await getKeyMaterial(password);
  const key = await getDerivationKey(keyMaterial, salt);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
};
