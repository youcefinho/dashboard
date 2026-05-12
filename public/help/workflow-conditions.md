# Ajouter des conditions

Les conditions filtrent l'exécution d'un workflow.

## Bloc "Si / Sinon"

Dans le constructeur de workflow, ajoutez un bloc **Condition** entre le déclencheur et les actions.

## Conditions sur lead

- Source = Facebook
- Tags contient "VIP"
- Statut = Qualifié
- Montant estimé > 1000$

## Conditions sur temps

- Heure entre 9h et 17h
- Jour de semaine (lun-ven)
- N'a pas reçu d'email depuis X jours

## Conditions combinées (AND/OR)

Combinez plusieurs conditions avec ET / OU pour des logiques complexes.

## Bonnes pratiques

- Limitez à 3-4 conditions par branche
- Préférez plusieurs workflows simples plutôt qu'un workflow géant
- Testez avec **Mode test** avant d'activer
