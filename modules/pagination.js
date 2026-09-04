/**
 * PAGINATION MODULE
 * Paginated embeds with Previous/Next buttons.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

async function paginate(interaction, pages, timeout = 60000) {
  if (!pages?.length) return;
  if (pages.length === 1) return interaction.reply({ embeds: [pages[0]] });

  let page = 0;

  const row = (p, disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('◀ PREV').setStyle(ButtonStyle.Secondary).setDisabled(disabled || p === 0),
    new ButtonBuilder().setCustomId('indicator').setLabel(`${p + 1} / ${pages.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId('next').setLabel('NEXT ▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || p === pages.length - 1)
  );

  const msg = await interaction.reply({ embeds: [pages[0]], components: [row(0)], fetchReply: true });

  const col = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: i => i.user.id === interaction.user.id
  });

  col.on('collect', async i => {
    if (i.customId === 'prev' && page > 0) page--;
    if (i.customId === 'next' && page < pages.length - 1) page++;
    await i.update({ embeds: [pages[page]], components: [row(page)] });
  });

  col.on('end', () => msg.edit({ components: [row(page, true)] }).catch(() => {}));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = { paginate, chunk };
