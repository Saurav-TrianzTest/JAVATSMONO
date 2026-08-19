// Untyped API response + unvalidated user input
export async function load(): Promise<any> {
  const res = await fetch('https://api.acme.com/data');
  const data: any = await res.json();
  return data;
}
interface UserProfile { id: string; name: string; }
export function handleInput(raw: string) {
  const parsed = JSON.parse(raw) as UserProfile;
  return parsed;
}
