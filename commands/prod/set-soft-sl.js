const { SlashCommandBuilder } = require('discord.js');
const { EventEmitter } = require('events');

const eventEmitter = new EventEmitter();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-soft-sl')
        .setDescription('Set soft SL')
        .addStringOption(option =>
            option.setName('coin')
                .setDescription('must be in format BTC, SOL, XRP, etc. do not add "USDT"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('direction')
                .setDescription('Set soft SL on long or short position?')
                .setRequired(true)
                .addChoices(
                    { name: 'long', value: 'long' },
                    { name: 'short', value: 'short' },
                ))
        .addNumberOption(option =>
            option.setName('price')
                .setDescription('Price of stop loss')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Timeframe to look for closure on')
                .setRequired(true)
                .addChoices(
                    { name: '1m', value: '1m' },
                    { name: '5m', value: '5m' },
                    { name: '15m', value: '15m' },
                    { name: '30m', value: '30m' },
                    { name: '1H', value: '1H' },
                    { name: '4H', value: '4H' },
                    { name: '6H', value: '6H' },
                    { name: '12H', value: '12H' },
                    { name: '1D', value: '1D' },
                )),
    async execute(interaction) {
        const coin = interaction.options.getString('coin').toUpperCase();
        const direction = interaction.options.getString('direction');
        const price = interaction.options.getNumber('price');
        const timeframe = interaction.options.getString('timeframe');

        await interaction.deferReply({ ephemeral: false });

        const slPosNotFoundListener = async () => {
            await interaction.followUp({ content: `An open \`${coin} ${direction}\` position was not found`, ephemeral: false });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
            eventEmitter.off('slTriggered', slTriggeredListener);
        };
        const slPosFoundListener = async (entry, margin, leverage, size) => {
            await interaction.followUp({ content: `An open \`${coin} ${direction}\` position was found:\n\`\`\`entry: ${entry}\nmargin: ${margin}\nleverage: ${leverage}\nsize: ${size}\`\`\``, ephemeral: false });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
            eventEmitter.off('slTriggered', slTriggeredListener);
        };
        const slTriggeredListener = async (closePrice) => {
            await interaction.followUp({ content: `Soft SL triggered on \`${coin} ${direction}\`\nclosed @ ${closePrice}`, ephemeral: false });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
            eventEmitter.off('slTriggered', slTriggeredListener);
        };

        eventEmitter.on('slPosNotFound', slPosNotFoundListener);
        eventEmitter.on('slPosFound', slPosFoundListener);

        eventEmitter.emit('softSlSet', { coin, direction, price, timeframe });
    },
    eventEmitter: eventEmitter,
};