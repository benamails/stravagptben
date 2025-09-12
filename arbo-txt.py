import os

def generer_arborescence_fichier(chemin, fichier_sortie="arborescence.txt", exclusions=None):
    """
    Génère l'arborescence en excluant les dossiers/fichiers spécifiés
    """
    if exclusions is None:
        exclusions = [".git", "node_modules", ".DS_Store", "__pycache__", ".next", "dist", "build"]

    def parcourir(chemin_actuel, prefixe="", lignes=[]):
        try:
            elements = sorted(os.listdir(chemin_actuel))
            elements_filtres = [e for e in elements if e not in exclusions]
            
            for index, element in enumerate(elements_filtres):
                chemin_complet = os.path.join(chemin_actuel, element)

                if index == len(elements_filtres) - 1:
                    connecteur = "└── "
                    nouveau_prefixe = prefixe + "    "
                else:
                    connecteur = "├── "
                    nouveau_prefixe = prefixe + "│   "

                if os.path.isdir(chemin_complet):
                    lignes.append(f"{prefixe}{connecteur}{element}/")
                    parcourir(chemin_complet, nouveau_prefixe, lignes)
                else:
                    lignes.append(f"{prefixe}{connecteur}{element}")
        except PermissionError:
            lignes.append(f"{prefixe}[Permission refusée]")

        return lignes

    lignes = [os.path.basename(os.path.abspath(chemin)) + "/"]
    arborescence = parcourir(chemin, "", lignes)

    with open(fichier_sortie, 'w', encoding='utf-8') as f:
        f.write('\n'.join(arborescence))

    print(f"Arborescence sauvegardée dans {fichier_sortie}")
    return arborescence

# Utilisation avec exclusions par défaut
arborescence = generer_arborescence_fichier("./")

# Ou avec exclusions personnalisées
# arborescence = generer_arborescence_fichier("./", exclusions=[".git", "node_modules", "custom_folder"])
