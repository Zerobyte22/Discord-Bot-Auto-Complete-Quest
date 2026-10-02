import 'dotenv/config';
import { Client } from 'discord.js-selfbot-v13';
import https from 'https';

// ✅ Recebe dados via env do index.ts
const TOKEN = process.env.SELF_TOKEN;
const SOURCE_GUILD = process.env.SOURCE_GUILD;
const TARGET_GUILD = process.env.TARGET_GUILD;
const CLONE_EMOJIS = process.env.CLONE_EMOJIS === 'true';
const PROGRESS_CHANNEL = process.env.PROGRESS_CHANNEL;

if (!TOKEN || !SOURCE_GUILD || !TARGET_GUILD) {
	console.error('❌ Faltando env: SELF_TOKEN, SOURCE_GUILD, TARGET_GUILD');
	process.exit(1);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emit(type: string, data: any = {}) {
	console.log(`__CLONER_EVT__${JSON.stringify({ type, ...data })}__CLONER_EVT__`);
}

async function downloadImage(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const buffer = Buffer.concat(chunks);
				const base64 = buffer.toString('base64');
				const mimeType = res.headers['content-type'] || 'image/png';
				resolve(`data:${mimeType};base64,${base64}`);
			});
			res.on('error', reject);
		}).on('error', reject);
	});
}

class ServerCloner {
	client: Client;
	roleMapping: Map<string, string> = new Map();
	stats = {
		rolesCreated: 0,
		categoriesCreated: 0,
		channelsCreated: 0,
		emojisCreated: 0,
		failed: 0,
	};
	progressChannel: any = null;

	constructor(client: Client) {
		this.client = client;
	}

	async setProgressChannel(channelId: string) {
		this.progressChannel = await this.client.channels.fetch(channelId).catch(() => null);
	}

	sendProgress(msg: string) {
		emit('progress', { message: msg });
		if (this.progressChannel && 'send' in this.progressChannel) {
			this.progressChannel.send(msg).catch(() => {});
		}
	}

	async cloneServer(sourceGuildId: string, targetGuildId: string, cloneEmojis = true) {
		try {
			const sourceGuild = this.client.guilds.cache.get(sourceGuildId);
			const targetGuild = this.client.guilds.cache.get(targetGuildId);

			if (!sourceGuild) throw new Error('Source server not found');
			if (!targetGuild) throw new Error('Target server not found');

			this.sendProgress(`Clonando: ${sourceGuild.name} → ${targetGuild.name}`);

			await this.deleteExistingContent(targetGuild);
			await this.cloneRoles(sourceGuild, targetGuild);
			await this.cloneCategories(sourceGuild, targetGuild);
			await this.cloneChannels(sourceGuild, targetGuild);

			if (cloneEmojis) {
				await this.cloneEmojis(sourceGuild, targetGuild);
			}

			await this.cloneServerInfo(sourceGuild, targetGuild);

			emit('done', { stats: this.stats });
			this.sendProgress('🎉 Clonagem concluída!');
		} catch (error: any) {
			emit('error', { message: error.message });
			this.sendProgress(`❌ Falha: ${error.message}`);
		}
	}

	async deleteExistingContent(guild: any) {
		this.sendProgress('🗑️ Deletando conteúdo existente...');

		for (const [, channel] of guild.channels.cache.filter((ch: any) => ch.deletable)) {
			try {
				await (channel as any).delete();
				await delay(100);
			} catch {
				this.stats.failed++;
			}
		}

		for (const [, role] of guild.roles.cache.filter((r: any) => r.name !== '@everyone' && !r.managed && r.editable)) {
			try {
				await (role as any).delete();
				await delay(100);
			} catch {
				this.stats.failed++;
			}
		}
	}

	async cloneRoles(sourceGuild: any, targetGuild: any) {
		this.sendProgress('👑 Clonando cargos...');

		const roles = sourceGuild.roles.cache
			.filter((r: any) => r.name !== '@everyone')
			.sort((a: any, b: any) => a.position - b.position);

		for (const [, role] of roles) {
			try {
				const newRole = await targetGuild.roles.create({
					name: role.name,
					color: role.hexColor,
					permissions: role.permissions,
					hoist: role.hoist,
					mentionable: role.mentionable,
					reason: 'Server cloning',
				});
				this.roleMapping.set(role.id, newRole.id);
				this.stats.rolesCreated++;
				await delay(200);
			} catch {
				this.stats.failed++;
			}
		}
	}

	async cloneCategories(sourceGuild: any, targetGuild: any) {
		this.sendProgress('📁 Clonando categorias...');

		const categories = sourceGuild.channels.cache
			.filter((ch: any) => ch.type === 'GUILD_CATEGORY')
			.sort((a: any, b: any) => a.position - b.position);

		for (const [, category] of categories) {
			try {
				const overwrites = this.mapPermissionOverwrites(category.permissionOverwrites, targetGuild);
				await targetGuild.channels.create(category.name, {
					type: 'GUILD_CATEGORY',
					permissionOverwrites: overwrites,
					position: category.position,
					reason: 'Server cloning',
				});
				this.stats.categoriesCreated++;
				await delay(200);
			} catch {
				this.stats.failed++;
			}
		}
	}

	async cloneChannels(sourceGuild: any, targetGuild: any) {
		this.sendProgress('💬 Clonando canais...');

		const channels = sourceGuild.channels.cache
			.filter((ch: any) => ch.type === 'GUILD_TEXT' || ch.type === 'GUILD_VOICE')
			.sort((a: any, b: any) => a.position - b.position);

		for (const [, channel] of channels) {
			try {
				const overwrites = this.mapPermissionOverwrites(channel.permissionOverwrites, targetGuild);
				const parent = channel.parent
					? targetGuild.channels.cache.find(
							(c: any) => c.name === channel.parent.name && c.type === 'GUILD_CATEGORY'
					  )
					: null;

				const options: any = {
					type: channel.type,
					parent: parent?.id,
					permissionOverwrites: overwrites,
					position: channel.position,
					reason: 'Server cloning',
				};

				if (channel.type === 'GUILD_TEXT') {
					options.topic = channel.topic || '';
					options.nsfw = channel.nsfw;
					options.rateLimitPerUser = channel.rateLimitPerUser;
				} else if (channel.type === 'GUILD_VOICE') {
					options.bitrate = channel.bitrate;
					options.userLimit = channel.userLimit;
				}

				await targetGuild.channels.create(channel.name, options);
				this.stats.channelsCreated++;
				await delay(200);
			} catch {
				this.stats.failed++;
			}
		}
	}

	async cloneEmojis(sourceGuild: any, targetGuild: any) {
		this.sendProgress('😀 Clonando emojis...');

		for (const [, emoji] of sourceGuild.emojis.cache) {
			try {
				const imageData = await downloadImage(emoji.url);
				await targetGuild.emojis.create(imageData, emoji.name, { reason: 'Server cloning' });
				this.stats.emojisCreated++;
				await delay(2000);
			} catch {
				this.stats.failed++;
			}
		}
	}

	async cloneServerInfo(sourceGuild: any, targetGuild: any) {
		this.sendProgress('🏠 Clonando info do servidor...');

		try {
			let iconData = null;
			if (sourceGuild.iconURL()) {
				try {
					iconData = await downloadImage(sourceGuild.iconURL({ format: 'png', size: 1024 }));
				} catch {}
			}

			await targetGuild.setName(sourceGuild.name);
			if (iconData) await targetGuild.setIcon(iconData);
		} catch {
			this.stats.failed++;
		}
	}

	mapPermissionOverwrites(overwrites: any, targetGuild: any): any[] {
		const mapped: any[] = [];
		if (!overwrites || !overwrites.cache) return mapped;

		overwrites.cache.forEach((overwrite: any) => {
			try {
				let targetId = overwrite.id;

				if (overwrite.type === 'role') {
					const newRoleId = this.roleMapping.get(overwrite.id);
					if (newRoleId) {
						targetId = newRoleId;
					} else {
						return;
					}
				}

				if (overwrite.allow !== undefined && overwrite.deny !== undefined) {
					mapped.push({
						id: targetId,
						type: overwrite.type,
						allow: overwrite.allow,
						deny: overwrite.deny,
					});
				}
			} catch {}
		});

		return mapped;
	}
}

// ✅ Main
const client = new Client();

client.on('ready', async () => {
	emit('log', { message: `Cloner logado como ${client.user?.tag}` });

	const cloner = new ServerCloner(client);
	if (PROGRESS_CHANNEL) {
		await cloner.setProgressChannel(PROGRESS_CHANNEL);
	}

	await cloner.cloneServer(SOURCE_GUILD!, TARGET_GUILD!, CLONE_EMOJIS);

	setTimeout(() => {
		client.destroy();
		process.exit(0);
	}, 5000);
});

client.login(TOKEN).catch((e: any) => {
	emit('error', { message: `Login falhou: ${e.message}` });
	process.exit(1);
});w
