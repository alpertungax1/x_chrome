import { logger } from '../utils/logger';

export class XActionHandler {
  /**
   * Kullanıcının profiline gidildikten sonra takipten çıkar.
   * Profil sayfasında çalışır (x.com/username).
   */
  public async unfollowFromProfilePage(): Promise<boolean> {
    try {
      // Sayfanın yüklenmesini bekle
      await this.waitForPageReady();
      
      // 1. data-testid ile "Following/Takip Ediyorsun" butonunu bul
      let unfollowBtn = document.querySelector('[data-testid$="-unfollow"]') as HTMLButtonElement;
      
      // 2. Fallback: Tüm butonlardan "Following" veya "Takip Ediyorsun" yazanı bul
      if (!unfollowBtn) {
        const buttons = Array.from(document.querySelectorAll('button'));
        unfollowBtn = buttons.find(btn => {
          const text = btn.innerText?.trim().toLowerCase() || '';
          return text === 'following' || text === 'takip ediyorsun';
        }) as HTMLButtonElement;
      }

      if (!unfollowBtn) {
        logger.warn('ActionHandler', 'Following button not found on profile page');
        return false;
      }

      // 3. Butona tıkla
      unfollowBtn.click();
      logger.log('ActionHandler', 'Clicked Following button');

      // 4. Onay modalını bekle
      await this.wait(800);
      
      // X.com'da unfollow tıklandığında bir onay dialogu açılır
      // data-testid="confirmationSheetConfirm" butonunu bul
      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLButtonElement;
      if (confirmBtn) {
        confirmBtn.click();
        logger.log('ActionHandler', 'Clicked confirmation button');
        await this.wait(500);
        return true;
      }
      
      // Bazı durumlarda onay dialogu olmadan direkt çıkılır
      logger.log('ActionHandler', 'No confirmation dialog found, assuming unfollow succeeded');
      return true;
    } catch (err) {
      logger.error('ActionHandler', 'Error unfollowing from profile', err);
      return false;
    }
  }

  /**
   * Kullanıcının profiline gidildikten sonra takip et.
   * Profil sayfasında çalışır (x.com/username).
   */
  public async followFromProfilePage(): Promise<boolean> {
    try {
      await this.waitForPageReady();

      // 1. data-testid ile "Follow" butonunu bul
      let followBtn = document.querySelector('[data-testid$="-follow"]') as HTMLButtonElement;

      // 2. Fallback: Tüm butonlardan "Follow" veya "Takip Et" yazanı bul
      if (!followBtn) {
        const buttons = Array.from(document.querySelectorAll('button'));
        followBtn = buttons.find(btn => {
          const text = btn.innerText?.trim().toLowerCase() || '';
          return text === 'follow' || text === 'takip et';
        }) as HTMLButtonElement;
      }

      if (!followBtn) {
        logger.warn('ActionHandler', 'Follow button not found on profile page');
        return false;
      }

      followBtn.click();
      logger.log('ActionHandler', 'Clicked Follow button');
      await this.wait(500);
      return true;
    } catch (err) {
      logger.error('ActionHandler', 'Error following from profile', err);
      return false;
    }
  }

  /**
   * UserCell listesindeyken (followers/following sayfasında) bir kullanıcıyı takipten çıkar.
   */
  public async unfollowUser(username: string): Promise<boolean> {
    try {
      const userCells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));
      
      const targetCell = userCells.find(cell => {
        const links = cell.querySelectorAll('a[href]');
        return Array.from(links).some(link => {
          const href = (link as HTMLAnchorElement).getAttribute('href') || '';
          return href === `/${username}`;
        });
      });

      if (!targetCell) {
        logger.warn('ActionHandler', `UserCell for ${username} not found on current page`);
        return false;
      }

      const unfollowBtn = targetCell.querySelector('[data-testid$="-unfollow"]') as HTMLButtonElement;
      
      if (!unfollowBtn) {
        logger.warn('ActionHandler', `Unfollow button for ${username} not found`);
        return true;
      }

      unfollowBtn.click();
      await this.wait(500);

      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLButtonElement;
      if (confirmBtn) {
        confirmBtn.click();
        await this.wait(500);
        logger.log('ActionHandler', `Successfully unfollowed ${username}`);
        return true;
      }
      
      return true; 
    } catch (err) {
      logger.error('ActionHandler', `Error unfollowing ${username}`, err);
      return false;
    }
  }

  /**
   * Sayfa DOM'unun yüklenmesini bekle (profil butonları vb.)
   */
  private async waitForPageReady(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Profil sayfasında bir buton var mı kontrol et
      const hasButtons = document.querySelectorAll('button').length > 3;
      if (hasButtons && document.readyState === 'complete') {
        return;
      }
      await this.wait(300);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
