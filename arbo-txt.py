import os

def generer_arborescence_fichier(chemin, fichier_sortie="arborescence.txt"):
    """
    Génère l'arborescence et la sauve dans un fichier
    """
    def parcourir(chemin_actuel, prefixe="", lignes=[]):
        try:
            elements = sorted(os.listdir(chemin_actuel))
            
            for index, element in enumerate(elements):
                chemin_complet = os.path.join(chemin_actuel, element)
                
                if index == len(elements) - 1:
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
    
    # Génère l'arborescence
    lignes = [os.path.basename(os.path.abspath(chemin)) + "/"]
    arborescence = parcourir(chemin, "", lignes)
    
    # Sauvegarde dans le fichier
    with open(fichier_sortie, 'w', encoding='utf-8') as f:
        f.write('\n'.join(arborescence))
    
    print(f"Arborescence sauvegardée dans {fichier_sortie}")
    return arborescence

# Utilisation
arborescence = generer_arborescence_fichier("./")
for ligne in arborescence:
    print(ligne)
