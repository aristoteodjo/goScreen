const buyer = {
  slug: 'acheteur', label: 'Acheteur', accent: '#e9a100',
  intro: { duration: 3, eyebrow: 'Pour les acheteurs', title: 'Vous cherchez des œufs ? <em>Voyez qui en a.</em>', sub: 'Votre numéro WhatsApp suffit. Vous payez OEUF D\'OR, pas le vendeur.' },
  outro: { duration: 3.2, eyebrow: 'oeufsdor.vercel.app', title: 'Trouvez. Payez. <em>Recevez.</em>', sub: 'Vos commandes et vos tickets au même endroit.' },
  scenes: [
    { rec: 'a1', id: 'A1', caption: 'Des œufs près de chez vous ?' },
    { rec: 'a1', id: 'A2', caption: 'Votre produit, votre quartier' },
    { rec: 'a1', id: 'A3', caption: 'Le vrai stock, en temps réel' },
    { rec: 'a1', id: 'A4', caption: 'Choisissez la quantité' },
    { rec: 'a1', id: 'A5', caption: 'Juste votre numéro WhatsApp' },
    { rec: 'a1', id: 'A6', caption: 'Votre stock est réservé' },
    { rec: 'a7', id: 'A7', from: 0.84, to: 21.5, caption: 'Vous payez OEUF D\'OR, pas le vendeur' },
    { rec: 'a7', id: 'A8', from: 21.5, to: 26.5, caption: 'Votre code de remise' },
    { rec: 'a7', id: 'A9', from: 145.4, to: 153.3, caption: 'Commande en main ? Donnez le code' },
    { rec: 'a2', id: 'A10', caption: 'Reçu. Notez le producteur' },
    { rec: 'a2', id: 'A11', caption: 'Tout votre historique' },
  ],
};
const producer = {
  slug: 'producteur', label: 'Producteur', accent: '#1e6a43',
  intro: { duration: 3, eyebrow: 'Pour les producteurs', title: 'Mettez votre stock en ligne. <em>Soyez payé.</em>', sub: 'Depuis votre téléphone, sans mot de passe.' },
  outro: { duration: 3.2, eyebrow: 'Espace producteur', title: 'Vous vendez. <em>OEUF D\'OR encaisse et vous reverse.</em>', sub: 'Votre compte est ouvert par l\'équipe OEUF D\'OR.' },
  scenes: [
    { rec: 'p1', id: 'P1', from: 0.8, to: 7.4, caption: 'Votre numéro WhatsApp suffit' },
    { rec: 'p1', id: 'P2', caption: 'Toute votre activité sur un écran' },
    { rec: 'p1', id: 'P3', caption: 'Un produit en moins d\'une minute' },
    { rec: 'p1', id: 'P4', caption: 'Vérifié : en vente tout de suite' },
    { rec: 'p1b', id: 'P5', caption: 'Nouvelle collecte ? Ajoutez un lot' },
    { rec: 'p1b', id: 'P6', caption: 'Des œufs cassés ? Retirez-les' },
    { rec: 'p1b', id: 'P7', caption: 'Chaque lot suivi jusqu\'à sa date limite' },
    { rec: 'p2', id: 'P8', caption: 'Une commande payée arrive' },
    { rec: 'p2', id: 'P9', caption: 'Saisissez le code de l\'acheteur' },
    { rec: 'p2', id: 'P10', from: 14.3, to: 16.7, caption: 'Terminée. L\'argent est à vous' },
    { rec: 'p11', id: 'P11', caption: 'Retirez sur votre Mobile Money' },
  ],
};
module.exports = { buyer, producer };
