import {
    Client,
    IntentsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,
    Interaction,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { exec, ChildProcess } from 'child_process';

// ============================================================
// PATHS
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG
// ============================================================
const GUILD_ID = '1504422135303634994';

// ============================================================
// FAKE PORT PARA RENDER
// ============================================================
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Auto Quest is running!');
});
server.listen(PORT, () => {
    console.log(`✅ Fake server running on port ${PORT}`);
});

// ============================================================
// TOKEN DO BOT
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN not found in environment variables!');
    console.log('📝 Add BOT_TOKEN to Render Environment Variables');
    process.exit(1);
}

// ============================================================
// STORAGE — TOKENS DOS USUÁRIOS
// ============================================================
const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');
const STATS_FILE = path.join(__dirname, 'user-stats.json');

interface UserStats {
    completed: number;
    lastRun: string | null;
}

function loadTokens(): Record<string, string> {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('❌ Error reading token file:', error);
    }
    return {};
}

function saveToken(userId: string, token: string): boolean {
    try {
        const tokens = loadTokens();
        tokens[userId] = token;
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error saving token:', error);
        return false;
    }
}

function getUserToken(userId: string): string | null {
    const tokens = loadTokens();
    return tokens[userId] || null;
}

function deleteToken(userId: string): boolean {
    try {
        const tokens = loadTokens();
        delete tokens[userId];
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error deleting token:', error);
        return false;
    }
}

function loadStats(): Record<string, UserStats> {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('❌ Error reading stats file:', error);
    }
    return {};
}

function saveStats(stats: Record<string, UserStats>): void {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (error) {
        console.error('❌ Error saving stats:', error);
    }
}

function incrementCompleted(userId: string): void {
    const stats = loadStats();
    if (!stats[userId]) stats[userId] = { completed: 0, lastRun: null };
    stats[userId].completed += 1;
    stats[userId].lastRun = new Date().toISOString();
    saveStats(stats);
}

// ============================================================
// CHILD PROCESS — RODA bot.ts EM ISOLAMENTO
// ============================================================
interface QuestProgress {
    logs: string[];
    onLog: (line: string) => void;
    onDone: (code: number, output: string, error: string) => void;
}

function runQuestInChildProcess(token: string, progress: QuestProgress): ChildProcess {
    const child = exec(`npx tsx bot.ts`, {
        cwd: __dirname,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, TOKEN: token, GITHUB_ACTIONS: 'false' },
    });

    let fullOutput = '';
    let errorOutput = '';

    child.stdout?.on('data', (data: string) => {
        fullOutput += data;
        data.toString().split('\n').filter(Boolean).forEach((line) => {
            console.log(line);
            progress.onLog(line);
        });
    });

    child.stderr?.on('data', (data: string) => {
        errorOutput += data;
        data.toString().split('\n').filter(Boolean).forEach((line) => {
            console.error(line);
            progress.onLog(`⚠️ ${line}`);
        });
    });

    child.on('close', (code: number) => {
        progress.onDone(code ?? 1, fullOutput, errorOutput);
    });

    child.on('error', (err: Error) => {
        progress.onDone(1, fullOutput, err.message);
    });

    return child;
}

// ============================================================
// BOT SETUP
// ============================================================
const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.DirectMessages,
    ],
});

let isRunning = false;
const ALLOWED_USERS: string[] = [];

// ============================================================
// CORES E ÍCONES
// ============================================================
const COLORS = {
    QUEST: 0x5865f2,
    SUCCESS: 0x2ecc71,
    ERROR: 0xe74c3c,
    WARNING: 0xf1c40f,
    DARK: 0x2b2d31,
    PURPLE: 0x8b5cf6,
    GOLD: 0xfee75c,
};

const ICON = {
    QUEST: '🏆',
    SYSTEM: '⚙️',
    VIDEO: '🎬',
    GAME: '🎮',
    TOKEN: '🔑',
    ROCKET: '🚀',
    CHECK: '✅',
    CROSS: '❌',
    WARN: '⚠️',
    LOADING: '⏳',
    USER: '👤',
    LOCK: '🔒',
    GHOST: '👻',
    BOOK: '📖',
    STAR: '⭐',
    CROWN: '👑',
};

// ============================================================
// BANNERS
// ============================================================
const BANNER_URL = process.env.BANNER_URL || 'https://i.imgur.com/AfFp7pu.png';
const LOGO_URL = process.env.LOGO_URL || 'https://i.imgur.com/AfFp7pu.png';

// ============================================================
// EMBED HELPERS
// ============================================================
function baseEmbed(
    title: string,
    description: string,
    color: number = COLORS.QUEST,
): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({
            text: 'Auto Quest • Sistema Automático',
            iconURL: client.user?.displayAvatarURL(),
        });
}

function mainPanelEmbed(): EmbedBuilder {
    return new EmbedBuilder()
        .setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
        .setTitle(`${ICON.GHOST} Auto Quest`)
        .setDescription(
            '**Auto Quest**\n' +
                `${ICON.GHOST} **Login** — Cole o token da sua conta Discord para usar os painéis.\n` +
                `${ICON.GHOST} **Auto Quest** — Complete missões Discord (vídeo, jogo, minigame) com o token da sua conta.\n` +
                `${ICON.GHOST} **Perfil**\n\n` +
                `${ICON.GHOST}${ICON.WARN} Use **Login → Auto-Quest** para concluir todas as suas missões.',
        )
        .setColor(COLORS.PURPLE)
        .setImage(BANNER_URL)
        .setTimestamp()
        .setFooter({ text: 'Auto Quest • Confira #chat para mais', iconURL: LOGO_URL });
}

function mainPanelButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('panel_login')
            .setLabel('Login')
            .setEmoji('👻')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('panel_autoquest')
            .setLabel('Auto-Quest')
            .setEmoji('👻')
            .setStyle(ButtonStyle.Primary),
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('panel_profile')
            .setLabel('Perfil')
            .setEmoji('👻')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('panel_help')
            .setLabel('Ajuda')
            .setEmoji('📖')
            .setStyle(ButtonStyle.Secondary),
    );

    return [row1, row2];
}

function buildLoginModal(): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId('modal_login')
        .setTitle('Login — token da sua conta');

    const tokenInput = new TextInputBuilder()
        .setCustomId('input_token')
        .setLabel('Token da conta (nunca compartilhe)')
        .setPlaceholder('Cole aqui o token da sua conta Discord...')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(30)
        .setMaxLength(200)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput),
    );
    return modal;
}

function loginSuccessEmbed(userTag: string, avatar: string, masked: string): EmbedBuilder {
    return new EmbedBuilder()
        .setAuthor({ name: `Login efetuado — ${userTag}`, iconURL: avatar })
        .setTitle(`${ICON.CHECK} Token Salvo com Sucesso!`)
        .setDescription(
            'Seu token foi armazenado. Agora você pode usar o botão **Auto-Quest** no painel.',
        )
        .addFields(
            {
                name: `${ICON.TOKEN} Token`,
                value: `\`${masked}\``,
                inline: false,
            },
            {
                name: `${ICON.USER} Usuário`,
                value: userTag,
                inline: true,
            },
            {
                name: `${ICON.ROCKET} Próximo Passo`,
                value: 'Clique em Auto-Quest',
                inline: true,
            },
        )
        .setColor(COLORS.SUCCESS)
        .setThumbnail(avatar)
        .setTimestamp()
        .setFooter({ text: 'Auto Quest • Login seguro', iconURL: LOGO_URL });
}

function profileEmbed(user: any, hasToken: boolean, stats: UserStats | null): EmbedBuilder {
    const token = getUserToken(user.id);
    const masked = token
        ? token.substring(0, 8) + '...' + token.substring(token.length - 4)
        : '— não registrado —';

    return new EmbedBuilder()
        .setAuthor({ name: `Perfil — ${user.tag}`, iconURL: user.displayAvatarURL() })
        .setTitle(`${ICON.GHOST} Perfil do Usuário`)
        .setDescription(
            hasToken
                ? `${ICON.CHECK} Conta conectada e pronta para usar o **Auto Quest**.`
                : `${ICON.WARN} Você ainda não fez login. Use o botão **Login** no painel.`,
        )
        .addFields(
            {
                name: `${ICON.USER} Usuário`,
                value: `<@${user.id}>`,
                inline: true,
            },
            {
                name: `${ICON.TOKEN} Token`,
                value: `\`${masked}\``,
                inline: false,
            },
            {
                name: `${ICON.CHECK} Quests concluídas`,
                value: `${stats?.completed ?? 0}`,
                inline: true,
            },
            {
                name: `${ICON.LOADING} Última execução`,
                value: stats?.lastRun
                    ? `<t:${Math.floor(new Date(stats.lastRun).getTime() / 1000)}:R>`
                    : 'Nunca executado',
                inline: true,
            },
        )
        .setColor(hasToken ? COLORS.PURPLE : COLORS.WARNING)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Auto Quest • Painel do usuário', iconURL: LOGO_URL });
}

function progressBar(percent: number, length: number = 12): string {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${percent}%**`;
}

function buildRunningEmbed(
    user: string,
    avatar: string,
    logs: string[],
    elapsedMs: number,
): EmbedBuilder {
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const estimatedTotal = 900;
    const percent = Math.min(99, Math.floor((elapsedSec / estimatedTotal) * 100));
    const recentLogs =
        logs.slice(-6).map((l) => `> ${l.slice(0, 100)}`).join('\n') ||
        '> Iniciando processo...';

    return new EmbedBuilder()
        .setAuthor({ name: `Executando para ${user}`, iconURL: avatar })
        .setTitle(`${ICON.LOADING} Processando Missões...`)
        .setDescription(
            `**Status:** 🟢 Em andamento\n${progressBar(percent)}\n\n**Últimos eventos:**\n${recentLogs}`,
        )
        .setColor(COLORS.QUEST)
        .setTimestamp()
        .setFooter({
            text: `Auto Quest • ${elapsedSec}s decorridos`,
            iconURL: LOGO_URL,
        });
}

// ============================================================
// REGISTRAR SLASH COMMANDS
// ============================================================
client.once('ready', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Bot online: ${client.user?.tag}`);
    console.log(`🆔 Bot ID: ${client.user?.id}`);
    console.log(`🏠 Guild ID configurado: ${GUILD_ID}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Verifica se o bot está no servidor
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        console.log(`✅ Bot está no servidor: ${guild.name}`);
    } catch (err) {
        console.error('❌ ERRO: O bot NÃO está no servidor com este GUILD_ID!');
        console.error('   Verifique o ID e se o bot foi convidado.');
        return;
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('painel')
            .setDescription('Enviar o painel Auto Quest no canal'),

        new SlashCommandBuilder()
            .setName('token')
            .setDescription('Salvar seu token do Discord')
            .addStringOption((option) =>
                option
                    .setName('token')
                    .setDescription('Seu token de usuário do Discord')
                    .setRequired(true),
            ),

        new SlashCommandBuilder()
            .setName('complete')
            .setDescription('Iniciar auto-complete das quests'),

        new SlashCommandBuilder()
            .setName('mytoken')
            .setDescription('Ver seu token salvo (parcialmente oculto)'),

        new SlashCommandBuilder()
            .setName('deltoken')
            .setDescription('Deletar seu token salvo'),

        new SlashCommandBuilder()
            .setName('perfil')
            .setDescription('Ver seu perfil e estatísticas'),

        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Mostrar o menu de ajuda'),

        new SlashCommandBuilder()
            .setName('about')
            .setDescription('Sobre o sistema Auto Quest'),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    // 1) Limpa comandos antigos
    try {
        console.log('🧹 Limpando comandos antigos da guild...');
        await rest.put(
            Routes.applicationGuildCommands(client.user!.id, GUILD_ID),
            { body: [] },
        );
        console.log('✅ Comandos antigos removidos.');
    } catch (err: any) {
        console.error('⚠️ Aviso ao limpar:', err?.message);
    }

    // 2) Registra comandos na guild
    try {
        console.log(`🔄 Registrando comandos na guild ${GUILD_ID}...`);
        const data = (await rest.put(
            Routes.applicationGuildCommands(client.user!.id, GUILD_ID),
            { body: commands },
        )) as any[];

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`✅ ${data.length} comandos registrados com SUCESSO!`);
        data.forEach((cmd, i) => {
            console.log(`   ${i + 1}. /${cmd.name} — ${cmd.description}`);
        });
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('💡 Se não aparecerem no Discord, feche e abra o app (Ctrl+R).');
    } catch (error: any) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ ERRO registrando comandos na guild:');
        console.error(`   Código: ${error?.code ?? 'desconhecido'}`);
        console.error(`   Mensagem: ${error?.message ?? error}`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // 3) Fallback: registra global
        try {
            console.log('🔄 Tentando registrar globalmente como fallback...');
            const data = (await rest.put(
                Routes.applicationCommands(client.user!.id),
                { body: commands },
            )) as any[];
            console.log(`✅ ${data.length} comandos registrados GLOBALMENTE!`);
            console.log('⏳ Aguarde até 1h para aparecerem em todos os servidores.');
        } catch (err2: any) {
            console.error('❌ Falha também no global:', err2?.message);
        }
    }
});

// ============================================================
// HANDLE AUTO-QUEST
// ============================================================
async function handleAutoQuest(interaction: any, user: any): Promise<void> {
    const token = getUserToken(user.id);

    if (!token) {
        await interaction.reply({
            embeds: [
                baseEmbed(
                    `${ICON.WARN} Login Necessário!`,
                    'Você precisa fazer login antes de usar o Auto-Quest.',
                    COLORS.WARNING,
                ).addFields({
                    name: '📝 Como fazer login',
                    value: 'Clique em **Login** no painel ou use `/token <seu_token>`.',
                }),
            ],
            ephemeral: true,
        });
        return;
    }

    if (isRunning) {
        await interaction.reply({
            embeds: [
                baseEmbed(
                    `${ICON.LOADING} Já em Execução`,
                    'Aguarde a execução atual terminar.',
                    COLORS.WARNING,
                ),
            ],
            ephemeral: true,
        });
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    const logs: string[] = [];

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_quest')
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🛑');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton);

    const startEmbed = new EmbedBuilder()
        .setAuthor({
            name: `Executando para ${user.tag}`,
            iconURL: user.displayAvatarURL(),
        })
        .setTitle(`${ICON.ROCKET} Iniciando Auto Quest!`)
        .setDescription(
            'O processo foi iniciado. Acompanhe o progresso em tempo real.\n\n' +
                `${progressBar(0)}\n\n> Aguardando primeiros eventos...`,
        )
        .setColor(COLORS.PURPLE)
        .setTimestamp()
        .setFooter({
            text: 'Auto Quest • Use o botão para cancelar',
            iconURL: LOGO_URL,
        });

    const reply = await interaction.reply({
        embeds: [startEmbed],
        components: [row],
        ephemeral: true,
        fetchReply: true,
    });

    let child: ChildProcess | null = null;
    let cancelled = false;

    const updateInterval = setInterval(async () => {
        if (cancelled) return;
        try {
            await interaction.editReply({
                embeds: [
                    buildRunningEmbed(
                        user.tag,
                        user.displayAvatarURL(),
                        logs,
                        Date.now() - startTime,
                    ),
                ],
                components: [row],
            });
        } catch {
            /* ignore */
        }
    }, 5000);

    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30 * 60 * 1000,
    });

    collector.on('collect', async (i: any) => {
        if (i.user.id !== user.id) {
            await i.reply({
                content: '❌ Apenas quem iniciou pode cancelar.',
                ephemeral: true,
            });
            return;
        }
        if (i.customId === 'cancel_quest') {
            cancelled = true;
            clearInterval(updateInterval);
            if (child) child.kill('SIGTERM');
            await i.update({
                embeds: [
                    baseEmbed(
                        `${ICON.WARN} Cancelado`,
                        'Execução cancelada pelo usuário.',
                        COLORS.WARNING,
                    ),
                ],
                components: [],
            });
        }
    });

    child = runQuestInChildProcess(token, {
        onLog: (line) => {
            logs.push(line.trim());
            if (logs.length > 200) logs.shift();
        },
        onDone: async (code, output, error) => {
            clearInterval(updateInterval);
            collector.stop();
            isRunning = false;

            const duration = ((Date.now() - startTime) / 60000).toFixed(1);
            const success = code === 0;

            if (success) incrementCompleted(user.id);

            const finalEmbed = new EmbedBuilder()
                .setAuthor({
                    name: `Resultado — ${user.tag}`,
                    iconURL: user.displayAvatarURL(),
                })
                .setTitle(
                    success
                        ? `${ICON.CHECK} Missões Concluídas!`
                        : `${ICON.CROSS} Execução Falhou!`,
                )
                .setDescription(
                    success
                        ? 'Todas as quests disponíveis foram processadas com sucesso.'
                        : 'Ocorreu um erro durante a execução.',
                )
                .addFields(
                    {
                        name: '📊 Resumo',
                        value: success
                            ? '```diff\n+ Quests processadas com sucesso!\n```'
                            : `\`\`\`\n${
                                  (error || output).slice(0, 900) ||
                                  'Erro desconhecido'
                              }\n\`\`\``,
                        inline: false,
                    },
                    {
                        name: '⏱️ Duração',
                        value: `${duration} min`,
                        inline: true,
                    },
                    {
                        name: `${ICON.USER} Usuário`,
                        value: user.tag,
                        inline: true,
                    },
                )
                .setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
                .setTimestamp()
                .setFooter({
                    text: 'Auto Quest • Obrigado por usar!',
                    iconURL: LOGO_URL,
                });

            try {
                await interaction.editReply({ embeds: [finalEmbed], components: [] });
            } catch {
                try {
                    await interaction.followUp({
                        embeds: [finalEmbed],
                        ephemeral: true,
                    });
                } catch {
                    /* ignore */
                }
            }

            console.log(
                success
                    ? `✅ ${user.tag} concluiu as quests.`
                    : `❌ ${user.tag} falhou (code ${code}).`,
            );
        },
    });
}

// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async (interaction: Interaction) => {
    try {
        // -------------------- SLASH COMMANDS --------------------
        if (interaction.isChatInputCommand()) {
            const { commandName, user } = interaction;

            if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(user.id)) {
                await interaction.reply({
                    embeds: [
                        baseEmbed(
                            `${ICON.CROSS} Acesso Negado`,
                            'Você não tem permissão para usar este bot.',
                            COLORS.ERROR,
                        ),
                    ],
                    ephemeral: true,
                });
                return;
            }

            // /painel
            if (commandName === 'painel') {
                await interaction.reply({
                    embeds: [mainPanelEmbed()],
                    components: mainPanelButtons(),
                });
                return;
            }

            // /about
            if (commandName === 'about') {
                await interaction.reply({ embeds: [mainPanelEmbed()] });
                return;
            }

            // /token
            if (commandName === 'token') {
                const token = interaction.options.getString('token', true);
                const saved = saveToken(user.id, token);

                if (saved) {
                    const masked =
                        token.substring(0, 8) +
                        '...' +
                        token.substring(token.length - 4);
                    await interaction.reply({
                        embeds: [
                            loginSuccessEmbed(
                                user.tag,
                                user.displayAvatarURL(),
                                masked,
                            ),
                        ],
                        ephemeral: true,
                    });
                    console.log(`🔑 ${user.tag} salvou o token via /token.`);
                } else {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.CROSS} Erro!`,
                                'Falha ao salvar o token. Tente novamente.',
                                COLORS.ERROR,
                            ),
                        ],
                        ephemeral: true,
                    });
                }
                return;
            }

            // /complete
            if (commandName === 'complete') {
                await handleAutoQuest(interaction, user);
                return;
            }

            // /mytoken
            if (commandName === 'mytoken') {
                const token = getUserToken(user.id);
                if (!token) {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.WARN} Nenhum Token Encontrado!`,
                                'Você ainda não salvou seu token.',
                                COLORS.WARNING,
                            ).addFields({
                                name: '📝 Instruções',
                                value:
                                    'Use `/token <seu_token>` ou o botão **Login** no painel.',
                            }),
                        ],
                        ephemeral: true,
                    });
                    return;
                }
                const masked =
                    token.substring(0, 8) +
                    '...' +
                    token.substring(token.length - 4);
                await interaction.reply({
                    embeds: [
                        baseEmbed(
                            `${ICON.TOKEN} Seu Token`,
                            'Este é o token salvo na sua conta.',
                            COLORS.QUEST,
                        )
                            .addFields(
                                {
                                    name: `${ICON.TOKEN} Token`,
                                    value: `\`${masked}\``,
                                    inline: false,
                                },
                                {
                                    name: '🆔 ID do Usuário',
                                    value: user.id,
                                    inline: true,
                                },
                            )
                            .setThumbnail(user.displayAvatarURL()),
                    ],
                    ephemeral: true,
                });
                return;
            }

            // /deltoken
            if (commandName === 'deltoken') {
                const deleted = deleteToken(user.id);
                if (deleted) {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.CHECK} Token Deletado!`,
                                'Seu token foi removido com sucesso.',
                                COLORS.SUCCESS,
                            ),
                        ],
                        ephemeral: true,
                    });
                    console.log(`🗑️ ${user.tag} deletou o token.`);
                } else {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.CROSS} Nenhum Token!`,
                                'Você não tem um token para deletar.',
                                COLORS.ERROR,
                            ),
                        ],
                        ephemeral: true,
                    });
                }
                return;
            }

            // /perfil
            if (commandName === 'perfil') {
                const token = getUserToken(user.id);
                const stats = loadStats()[user.id] ?? null;
                await interaction.reply({
                    embeds: [profileEmbed(user, !!token, stats)],
                    ephemeral: true,
                });
                return;
            }

            // /help
            if (commandName === 'help') {
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
                            .setTitle(`${ICON.BOOK} Menu de Ajuda`)
                            .setDescription(
                                'Use `/painel` para abrir o painel principal. Ou utilize os comandos abaixo:',
                            )
                            .addFields(
                                {
                                    name: '🖼️ `/painel`',
                                    value: 'Envia o painel no canal',
                                    inline: false,
                                },
                                {
                                    name: `${ICON.TOKEN} \`/token <token>\``,
                                    value: 'Salvar seu token de usuário',
                                    inline: false,
                                },
                                {
                                    name: `${ICON.ROCKET} \`/complete\``,
                                    value: 'Iniciar o auto-complete das quests',
                                    inline: false,
                                },
                                {
                                    name: '🔍 `/mytoken`',
                                    value: 'Ver seu token salvo (oculto)',
                                    inline: false,
                                },
                                {
                                    name: '🗑️ `/deltoken`',
                                    value: 'Deletar seu token salvo',
                                    inline: false,
                                },
                                {
                                    name: `${ICON.USER} \`/perfil\``,
                                    value: 'Ver seu perfil e estatísticas',
                                    inline: false,
                                },
                                {
                                    name: `${ICON.QUEST} \`/about\``,
                                    value: 'Sobre o sistema Auto Quest',
                                    inline: false,
                                },
                            )
                            .setColor(COLORS.DARK)
                            .setFooter({
                                text: '⚠️ Este é um selfbot - use por sua conta e risco!',
                                iconURL: LOGO_URL,
                            })
                            .setTimestamp(),
                    ],
                    ephemeral: true,
                });
                return;
            }
        }

        // -------------------- BOTÕES --------------------
        if (interaction.isButton()) {
            const { customId, user } = interaction;

            if (customId === 'panel_login') {
                await interaction.showModal(buildLoginModal());
                return;
            }

            if (customId === 'panel_autoquest') {
                await handleAutoQuest(interaction, user);
                return;
            }

            if (customId === 'panel_profile') {
                const token = getUserToken(user.id);
                const stats = loadStats()[user.id] ?? null;
                await interaction.reply({
                    embeds: [profileEmbed(user, !!token, stats)],
                    ephemeral: true,
                });
                return;
            }

            if (customId === 'panel_help') {
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`${ICON.BOOK} Ajuda Rápida`)
                            .setDescription(
                                '1. Clique em **Login** e cole o token da sua conta.\n' +
                                    '2. Clique em **Auto-Quest** para iniciar.\n' +
                                    '3. Acompanhe o progresso em tempo real.\n' +
                                    '4. Veja seu histórico em **Perfil**.',
                            )
                            .setColor(COLORS.PURPLE)
                            .setTimestamp()
                            .setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
                    ],
                    ephemeral: true,
                });
                return;
            }

            if (customId === 'cancel_quest') {
                await interaction.reply({
                    embeds: [
                        baseEmbed(
                            `${ICON.WARN} Cancelamento`,
                            'Solicitação recebida...',
                            COLORS.WARNING,
                        ),
                    ],
                    ephemeral: true,
                });
                return;
            }
        }

        // -------------------- MODAIS --------------------
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_login') {
                const token = interaction.fields
                    .getTextInputValue('input_token')
                    .trim();
                const user = interaction.user;

                if (token.length < 30 || token.split('.').length < 3) {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.CROSS} Token Inválido`,
                                'O formato do token não parece válido. Certifique-se de copiar o token completo.',
                                COLORS.ERROR,
                            ),
                        ],
                        ephemeral: true,
                    });
                    return;
                }

                const saved = saveToken(user.id, token);
                const masked =
                    token.substring(0, 8) +
                    '...' +
                    token.substring(token.length - 4);

                if (saved) {
                    await interaction.reply({
                        embeds: [
                            loginSuccessEmbed(
                                user.tag,
                                user.displayAvatarURL(),
                                masked,
                            ),
                        ],
                        ephemeral: true,
                    });
                    console.log(`🔑 ${user.tag} fez login via modal.`);
                } else {
                    await interaction.reply({
                        embeds: [
                            baseEmbed(
                                `${ICON.CROSS} Erro!`,
                                'Falha ao salvar o token. Tente novamente.',
                                COLORS.ERROR,
                            ),
                        ],
                        ephemeral: true,
                    });
                }
                return;
            }
        }
    } catch (err) {
        console.error('Erro em interactionCreate:', err);
        try {
            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    embeds: [
                        baseEmbed(
                            `${ICON.CROSS} Erro interno`,
                            'Algo deu errado. Tente novamente.',
                            COLORS.ERROR,
                        ),
                    ],
                    ephemeral: true,
                });
            }
        } catch {
            /* ignore */
        }
    }
});

// ============================================================
// LOGIN DO BOT
// ============================================================
client.login(BOT_TOKEN).catch((error) => {
    console.error('❌ Falha no login:', error);
});

// ============================================================
// HANDLERS GLOBAIS
// ============================================================
process.on('unhandledRejection', (reason) => {
    console.error('[Error] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
});