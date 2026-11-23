import { notFound } from '../errors';
import { deleteAvatar, getAvatar, insertAvatar, listAvatars, updateAvatar } from '../repo/avatars';
import type { AvatarDTO } from '../types';

export const listAllAvatars = (): AvatarDTO[] => listAvatars();

export const createAvatar = (input: { name: string; description: string }): AvatarDTO => insertAvatar(input);

export function editAvatar(id: string, input: { name: string; description: string }): AvatarDTO {
  if (!getAvatar(id)) throw notFound('Avatar');
  updateAvatar(id, input);
  return getAvatar(id)!;
}

export function removeAvatar(id: string): void {
  if (!getAvatar(id)) throw notFound('Avatar');
  deleteAvatar(id);
}
